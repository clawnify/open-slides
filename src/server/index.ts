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
import { parseTokens, brandHead, brandLogoTag, setTokensInMd, DEFAULT_BRAND_MD, type BrandTokens } from "./brand";
import { TEMPLATES } from "./templates";
import { generate, editBrand, hasAiKey } from "./ai";

type Bindings = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  // Injected into every WfP app at deploy time; authorizes managed services
  // (here: the PDF render service). Absent in local dev unless set in .dev.vars.
  CLAWNIFY_TOKEN?: string;
  // LLM keys for natural-language generation. OPENROUTER_API_KEY is the platform
  // standard (injected in prod); ANTHROPIC_API_KEY is supported as BYOK and wins
  // when both are present.
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
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
  nav: string;
  brand_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Nav {
  arrows: boolean;
  progress: boolean;
  slideNumber: boolean;
}
const DEFAULT_NAV: Nav = { arrows: true, progress: true, slideNumber: true };
function parseNav(s: string | undefined): Nav {
  try {
    return { ...DEFAULT_NAV, ...(s ? JSON.parse(s) : {}) };
  } catch {
    return DEFAULT_NAV;
  }
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
    `UPDATE decks SET title = ?, content = ?, theme = ?, nav = ?, brand_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [b.title ?? existing.title, b.content ?? existing.content, b.theme ?? existing.theme, b.nav ?? existing.nav, b.brand_id ?? existing.brand_id, id],
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
  const row = await get<Deck>("SELECT content, theme, nav, brand_id FROM decks WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.text("Not found", 404);
  const h = parseInt(c.req.query("h") || "0", 10) || 0;
  const v = parseInt(c.req.query("v") || "0", 10) || 0;
  const onlyRaw = c.req.query("only");
  const only = onlyRaw != null ? parseInt(onlyRaw, 10) : undefined;
  const thumb = c.req.query("thumb") === "1";
  const tokens = parseTokens(await brandMdFor(row.brand_id));
  return c.html(
    revealDoc({
      mode: "view",
      content: rewriteAssetsForView(row.content),
      theme: row.theme,
      brandHeadHtml: brandHead(tokens),
      brandLogoHtml: thumb ? "" : brandLogoTag(resolveLogoForView(tokens.logo)),
      h,
      v,
      only: Number.isFinite(only) ? only : undefined,
      thumb,
      nav: thumb ? { arrows: false, progress: false, slideNumber: false } : parseNav(row.nav),
    }),
  );
});

// Natural-language slide generation. Returns generated content in the deck
// format; the client inserts/replaces. mode: deck | slide | edit.
app.post("/api/generate", async (c) => {
  const b = await c.req.json<{ prompt?: string; current_slide?: string; deck_context?: string; deck_id?: string }>();
  if (!b.prompt?.trim()) return c.json({ error: "prompt is required" }, 400);
  if (!hasAiKey(c.env)) {
    return c.json({ error: "AI generation isn't configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)." }, 503);
  }
  try {
    const deck = b.deck_id ? await get<Deck>("SELECT brand_id FROM decks WHERE id = ?", [b.deck_id]) : null;
    const designMd = await brandMdFor(deck?.brand_id);
    const result = await generate(c.env, {
      prompt: b.prompt.trim(),
      tokens: parseTokens(designMd),
      designMd,
      templates: TEMPLATES,
      currentSlide: b.current_slide,
      deckContext: b.deck_context,
    });
    return c.json(result); // { action, content }
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

// ── Brand library (each deck picks one) ──────────────────────────────

interface Brand {
  id: string;
  name: string;
  design_md: string;
  created_at: string;
  updated_at: string;
}

// Always keep at least one brand; seed "Default" on first use.
async function ensureBrands(): Promise<Brand[]> {
  let rows = await query<Brand>("SELECT * FROM brands ORDER BY created_at ASC");
  if (rows.length === 0) {
    await run("INSERT INTO brands (name, design_md) VALUES (?, ?)", ["Default", DEFAULT_BRAND_MD]);
    rows = await query<Brand>("SELECT * FROM brands ORDER BY created_at ASC");
  }
  return rows;
}
// The DESIGN.md a deck renders with (its brand, or the first/default brand).
async function brandMdFor(brandId: string | null | undefined): Promise<string> {
  const rows = await ensureBrands();
  const b = (brandId && rows.find((r) => r.id === brandId)) || rows[0];
  return b.design_md || DEFAULT_BRAND_MD;
}

app.get("/api/brands", async (c) => {
  const rows = await ensureBrands();
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, tokens: parseTokens(r.design_md) })));
});

app.get("/api/brands/:id", async (c) => {
  const row = await get<Brand>("SELECT * FROM brands WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ id: row.id, name: row.name, design_md: row.design_md, tokens: parseTokens(row.design_md) });
});

app.post("/api/brands", async (c) => {
  const b = await c.req.json<{ name?: string; design_md?: string }>();
  const res = await run("INSERT INTO brands (name, design_md) VALUES (?, ?)", [b.name?.trim() || "New brand", b.design_md || DEFAULT_BRAND_MD]);
  const row = await get<Brand>("SELECT * FROM brands WHERE rowid = ?", [res.lastInsertRowid]);
  return c.json(row, 201);
});

app.put("/api/brands/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await get<Brand>("SELECT * FROM brands WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const b = await c.req.json<{ name?: string; design_md?: string; tokens?: BrandTokens }>();
  // Visual inspector sends tokens (written into the md block); editors send md.
  const nextMd = b.tokens ? setTokensInMd(existing.design_md, b.tokens) : (b.design_md ?? existing.design_md);
  await run("UPDATE brands SET name = ?, design_md = ?, updated_at = datetime('now') WHERE id = ?", [b.name ?? existing.name, nextMd, id]);
  const row = await get<Brand>("SELECT * FROM brands WHERE id = ?", [id]);
  return c.json({ id: row!.id, name: row!.name, design_md: row!.design_md, tokens: parseTokens(row!.design_md) });
});

app.delete("/api/brands/:id", async (c) => {
  await run("DELETE FROM brands WHERE id = ?", [c.req.param("id")]);
  await ensureBrands(); // never leave the library empty
  return c.json({ ok: true });
});

// Edit a brand by natural-language instruction.
app.post("/api/brands/:id/prompt", async (c) => {
  const id = c.req.param("id");
  const existing = await get<Brand>("SELECT * FROM brands WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const { instruction } = await c.req.json<{ instruction?: string }>();
  if (!instruction?.trim()) return c.json({ error: "instruction is required" }, 400);
  if (!hasAiKey(c.env)) return c.json({ error: "AI isn't configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)." }, 503);
  try {
    const nextMd = await editBrand(c.env, { instruction: instruction.trim(), currentMd: existing.design_md });
    await run("UPDATE brands SET design_md = ?, updated_at = datetime('now') WHERE id = ?", [nextMd, id]);
    return c.json({ id, name: existing.name, design_md: nextMd, tokens: parseTokens(nextMd) });
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

// Full preview of a brand: a small sample deck rendered with it.
const BRAND_SAMPLE = [
  `<!-- html -->\n<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;padding:0 9%;box-sizing:border-box"><div class="kicker" style="font-size:22px">Brand preview</div><h1 style="font:700 var(--brand-hero-size)/1.02 var(--r-heading-font);color:var(--brand-heading);margin:14px 0 0">The quick brown fox</h1><p style="font:400 var(--brand-body-size)/1.4 var(--r-main-font);color:var(--brand-muted);max-width:72%;margin-top:18px">A supporting line set in the body font and color.</p></div>`,
  `## A markdown slide\n\n- Bullet one\n- Bullet two\n\n> A short quote in the brand voice.`,
  `<!-- html -->\n<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 9%;box-sizing:border-box"><div style="font:700 200px/1 var(--r-heading-font);color:var(--brand-accent)">98%</div><p style="font:400 var(--brand-body-size)/1.3 var(--r-main-font);color:var(--brand-text)">Accent color on a big stat.</p></div>`,
].join("\n\n---\n\n");

app.get("/api/brands/:id/preview", async (c) => {
  const tokens = parseTokens(await brandMdFor(c.req.param("id")));
  return c.html(
    revealDoc({
      mode: "view",
      content: BRAND_SAMPLE,
      theme: "black",
      brandHeadHtml: brandHead(tokens),
      brandLogoHtml: brandLogoTag(resolveLogoForView(tokens.logo)),
      nav: { arrows: true, progress: false, slideNumber: false },
    }),
  );
});

// Designed, on-brand slide templates the client inserts into a deck.
app.get("/api/templates", (c) => c.json(TEMPLATES));

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
  // route, so inline any referenced media (and the logo) as data: URIs.
  const tokens = parseTokens(await brandMdFor(row.brand_id));
  const content = await inlineAssets(row.content);
  const html = revealDoc({
    mode: "print",
    content,
    theme: row.theme,
    brandHeadHtml: brandHead(tokens),
    brandLogoHtml: brandLogoTag(await resolveLogoForPrint(tokens.logo)),
  });

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

// View mode: media is same-origin with the app, so point `assets/<key>` at the
// served R2 route.
function rewriteAssetsForView(s: string): string {
  return s.replace(/(["'(])assets\//g, "$1/api/uploads/");
}

function resolveLogoForView(logo: string): string {
  if (!logo) return "";
  return logo.startsWith("assets/") ? `/api/uploads/${logo.slice("assets/".length)}` : logo;
}

async function resolveLogoForPrint(logo: string): Promise<string> {
  if (!logo) return "";
  if (!logo.startsWith("assets/")) return logo; // external URL
  const obj = await getUploadBytes(logo.slice("assets/".length));
  if (!obj) return "";
  return `data:${obj.contentType};base64,${arrayBufferToBase64(obj.data)}`;
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
