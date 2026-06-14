import { Hono } from "hono";
import { initDB, query, get, run } from "./db";
import {
  initUploads,
  putUpload,
  getUpload,
  getUploadBytes,
  deleteUpload,
  makeKey,
} from "./uploads";
import { revealDoc } from "./reveal";
import { renderDeckPdf, PdfRenderError } from "./pdf";

type Bindings = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  // Injected into every WfP app at deploy time; authorizes managed services
  // (here: the PDF render service). Absent in local dev unless set in .dev.vars.
  CLAWNIFY_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", async (c, next) => {
  initDB(c.env);
  initUploads(c.env.UPLOADS);
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || String(err) }, 500);
});

// ── Decks ────────────────────────────────────────────────────────────

interface Deck {
  id: string;
  title: string;
  content: string;
  theme: string;
  created_at: string;
  updated_at: string;
}

app.get("/api/decks", async (c) => {
  const rows = await query<Deck>("SELECT * FROM decks ORDER BY updated_at DESC");
  return c.json(rows);
});

app.get("/api/decks/:id", async (c) => {
  const row = await get<Deck>("SELECT * FROM decks WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.post("/api/decks", async (c) => {
  const b = await c.req.json<Partial<Deck>>();
  if (!b.title?.trim()) return c.json({ error: "title is required" }, 400);
  const res = await run(
    "INSERT INTO decks (title, content, theme) VALUES (?, ?, ?)",
    [b.title.trim(), b.content ?? "", b.theme ?? "white"],
  );
  const row = await get<Deck>("SELECT * FROM decks WHERE rowid = ?", [res.lastInsertRowid]);
  return c.json(row, 201);
});

app.put("/api/decks/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await get<Deck>("SELECT * FROM decks WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const b = await c.req.json<Partial<Deck>>();
  await run(
    `UPDATE decks SET title = ?, content = ?, theme = ?, updated_at = datetime('now') WHERE id = ?`,
    [b.title ?? existing.title, b.content ?? existing.content, b.theme ?? existing.theme, id],
  );
  const row = await get<Deck>("SELECT * FROM decks WHERE id = ?", [id]);
  return c.json(row);
});

app.delete("/api/decks/:id", async (c) => {
  await run("DELETE FROM decks WHERE id = ?", [c.req.param("id")]);
  return c.json({ ok: true });
});

// Interactive reveal.js deck — loaded by the editor's preview iframe and
// fullscreened for in-app presenting. ?h=&v= restores the current slide.
app.get("/api/decks/:id/view", async (c) => {
  const row = await get<Deck>("SELECT content, theme FROM decks WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.text("Not found", 404);
  const h = parseInt(c.req.query("h") || "0", 10) || 0;
  const v = parseInt(c.req.query("v") || "0", 10) || 0;
  return c.html(revealDoc({ mode: "view", content: row.content, theme: row.theme, h, v }));
});

// Export the deck to PDF (one slide per page) via the managed PDF service.
app.get("/api/decks/:id/pdf", async (c) => {
  const row = await get<Deck>("SELECT * FROM decks WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!c.env.CLAWNIFY_TOKEN) {
    return c.json(
      { error: "PDF export not configured (missing CLAWNIFY_TOKEN). Export runs on deployed apps." },
      503,
    );
  }

  // The headless renderer can't reach the app's authenticated /api/uploads
  // route, so inline any referenced media as data: URIs before rendering.
  const content = await inlineAssets(row.content);
  const html = revealDoc({ mode: "print", content, theme: row.theme });

  try {
    const pdf = await renderDeckPdf(c.env.CLAWNIFY_TOKEN, html);
    const filename = `${makeKey(row.title)}.pdf`;
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const detail = err instanceof PdfRenderError ? err.detail || err.message : String(err);
    return c.json({ error: "pdf_render_failed", detail }, 502);
  }
});

// ── Assets (media library) ───────────────────────────────────────────

interface Asset {
  id: string;
  key: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
}

app.get("/api/assets", async (c) => {
  const rows = await query<Asset>("SELECT * FROM assets ORDER BY created_at DESC");
  return c.json(rows);
});

app.post("/api/assets", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") return c.json({ error: "No file provided" }, 400);

  let key = makeKey(file.name || "file");
  const clash = await get<{ id: string }>("SELECT id FROM assets WHERE key = ?", [key]);
  if (clash) {
    const dot = key.lastIndexOf(".");
    const suffix = lower8();
    key = dot > 0 ? `${key.slice(0, dot)}-${suffix}${key.slice(dot)}` : `${key}-${suffix}`;
  }

  const data = await file.arrayBuffer();
  const contentType = file.type || "application/octet-stream";
  await putUpload(key, data, contentType);

  const res = await run(
    "INSERT INTO assets (key, name, content_type, size) VALUES (?, ?, ?, ?)",
    [key, file.name || key, contentType, data.byteLength],
  );
  const row = await get<Asset>("SELECT * FROM assets WHERE rowid = ?", [res.lastInsertRowid]);
  return c.json(row, 201);
});

app.delete("/api/assets/:id", async (c) => {
  const row = await get<Asset>("SELECT * FROM assets WHERE id = ?", [c.req.param("id")]);
  if (row) {
    await deleteUpload(row.key);
    await run("DELETE FROM assets WHERE id = ?", [row.id]);
  }
  return c.json({ ok: true });
});

app.get("/api/uploads/:key", async (c) => {
  const obj = await getUpload(c.req.param("key"));
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.data, {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=31536000" },
  });
});

// ── helpers ──────────────────────────────────────────────────────────

function lower8(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Replace `assets/<key>` references with inline data: URIs for PDF export.
// Bounded so a malicious/huge deck can't blow up the render payload.
async function inlineAssets(content: string): Promise<string> {
  const keys = new Set<string>();
  for (const m of content.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) keys.add(m[1]);
  if (keys.size === 0) return content;

  let out = content;
  let count = 0;
  for (const key of keys) {
    if (count >= 30) break;
    const obj = await getUploadBytes(key);
    if (!obj || obj.data.byteLength > 8 * 1024 * 1024) continue;
    const dataUri = `data:${obj.contentType};base64,${arrayBufferToBase64(obj.data)}`;
    out = out.split(`assets/${key}`).join(dataUri);
    count++;
  }
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default app;
