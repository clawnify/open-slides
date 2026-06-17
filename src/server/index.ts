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
import { renderDeckPdf, renderSlidePng, PdfRenderError } from "./pdf";
import { parseTokens, brandHead, brandLogoTag, brandGuideHtml, setTokensInMd, DEFAULT_BRAND_MD, type BrandTokens } from "./brand";
import { TEMPLATES } from "./templates";
import { generate, editBrand, hasAiKey, type DeckOps, type DeckSlide, type AuthoredSlide, type BrandOps, type BrandTokensPatch } from "./ai";
import { bakeInfographics } from "./infographic";

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

// Pagination is a single mutually-exclusive choice.
type NavMode = "dots" | "arrows" | "numbers" | "none";
interface Nav { mode: NavMode }
const DEFAULT_NAV: Nav = { mode: "dots" }; // centered dots by default
const NAV_MODES: NavMode[] = ["dots", "arrows", "numbers", "none"];

// Tolerate the legacy {arrows,progress,slideNumber,dots} shape by collapsing it
// to a single mode (decks created before pagination became one choice).
function parseNav(s: string | undefined): Nav {
  try {
    const o = s ? JSON.parse(s) : {};
    if (typeof o.mode === "string" && NAV_MODES.includes(o.mode)) return { mode: o.mode };
    if (o.dots) return { mode: "dots" };
    if (o.arrows || o.progress) return { mode: "arrows" };
    if (o.slideNumber) return { mode: "numbers" };
    if (Object.keys(o).length) return { mode: "none" };
    return { ...DEFAULT_NAV };
  } catch {
    return { ...DEFAULT_NAV };
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
    "INSERT INTO decks (title, content, theme, brand_id, nav) VALUES (?, ?, ?, ?, ?)",
    [b.title.trim(), b.content ?? "", b.theme ?? "black", b.brand_id ?? null, JSON.stringify(DEFAULT_NAV)],
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
  scheduleSweep(c); // a media reference may have just been removed
  return c.json(row);
});

app.delete("/api/decks/:id", async (c) => {
  await run("DELETE FROM decks WHERE id = ?", [c.req.param("id")]);
  scheduleSweep(c);
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
  // Render any infographic DSL → brand-themed SVG before serving.
  const baked = await bakeInfographics(row.content, { colorPrimary: tokens.colors.accent, colorBg: tokens.colors.bg });
  return c.html(
    revealDoc({
      mode: "view",
      content: rewriteAssetsForView(baked),
      theme: row.theme,
      brandHeadHtml: brandHead(tokens),
      brandLogoHtml: thumb ? "" : brandLogoTag(resolveLogoForView(tokens.logo)),
      h,
      v,
      only: Number.isFinite(only) ? only : undefined,
      thumb,
      nav: thumb ? { mode: "none" } : parseNav(row.nav),
    }),
  );
});

// Natural-language slide generation as a live agent loop. The model drives the
// deck through composable verbs (add/edit/delete slide); each verb persists the
// deck and streams the change to the client over Server-Sent Events, so slides
// appear one at a time while the agent keeps working.
//
// SSE events (one JSON object per `data:` frame):
//   { type: "slide", sel, total, content }  — deck changed; `sel` = focus index
//   { type: "done",  total, content }
//   { type: "error", error }
app.post("/api/decks/:id/generate", async (c) => {
  const id = c.req.param("id");
  const deck = await get<Deck>("SELECT * FROM decks WHERE id = ?", [id]);
  if (!deck) return c.json({ error: "Not found" }, 404);
  const b = await c.req.json<{ prompt?: string; current_index?: number }>();
  if (!b.prompt?.trim()) return c.json({ error: "prompt is required" }, 400);
  if (!hasAiKey(c.env)) {
    return c.json({ error: "AI generation isn't configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)." }, 503);
  }

  const designMd = await brandMdFor(deck.brand_id);
  const chunks = splitDeck(deck.content);
  const snapshot = (): DeckSlide[] => chunks.map((ch, i) => ({ index: i, ...extractNotes(ch) }));

  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (obj: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const persist = async (sel: number) => {
    const content = joinDeck(chunks);
    await run("UPDATE decks SET content = ?, updated_at = datetime('now') WHERE id = ?", [content, id]);
    await send({ type: "slide", sel, total: chunks.length, content });
  };

  const ops: DeckOps = {
    read: async () => snapshot(),
    add: async (slide, afterIndex) => {
      const at = afterIndex == null || afterIndex < 0 || afterIndex >= chunks.length ? chunks.length : afterIndex + 1;
      chunks.splice(at, 0, assembleChunk(slide));
      await persist(at);
      return at;
    },
    edit: async (index, slide) => {
      if (index < 0 || index >= chunks.length) throw new Error(`no slide at index ${index} (deck has ${chunks.length})`);
      chunks[index] = assembleChunk(slide);
      await persist(index);
    },
    remove: async (index) => {
      if (index < 0 || index >= chunks.length) throw new Error(`no slide at index ${index} (deck has ${chunks.length})`);
      chunks.splice(index, 1);
      await persist(Math.max(0, index - 1));
    },
    renderPng: async (index) => {
      if (!c.env.CLAWNIFY_TOKEN) return null; // no managed render off-platform
      if (index < 0 || index >= chunks.length) return null;
      try {
        const html = await slidePrintHtml(chunks[index], deck.theme, parseTokens(designMd));
        return arrayBufferToBase64(await renderSlidePng(c.env.CLAWNIFY_TOKEN, html));
      } catch (e) {
        console.error("view_slide render failed", e);
        return null;
      }
    },
  };

  // Drive the loop in the background; the streamed response keeps the worker
  // alive until we close the writer, and waitUntil guards against early teardown.
  const run$ = (async () => {
    try {
      await generate(
        c.env,
        {
          prompt: b.prompt!.trim(),
          tokens: parseTokens(designMd),
          designMd,
          templates: TEMPLATES,
          currentIndex: b.current_index ?? 0,
          deck: snapshot(),
        },
        ops,
      );
      await send({ type: "done", total: chunks.length, content: joinDeck(chunks) });
    } catch (err) {
      await send({ type: "error", error: String(err instanceof Error ? err.message : err) });
    } finally {
      scheduleSweep(c); // a deck rewrite may have dropped a media reference
      await writer.close().catch(() => {});
    }
  })();
  try { c.executionCtx?.waitUntil(run$); } catch { /* no execution ctx in some dev paths */ }

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
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
  scheduleSweep(c); // the logo may have been changed or cleared
  return c.json({ id: row!.id, name: row!.name, design_md: row!.design_md, tokens: parseTokens(row!.design_md) });
});

app.delete("/api/brands/:id", async (c) => {
  await run("DELETE FROM brands WHERE id = ?", [c.req.param("id")]);
  await ensureBrands(); // never leave the library empty
  scheduleSweep(c);
  return c.json({ ok: true });
});

// Edit a brand by natural-language instruction — a live agent loop. The model
// adjusts tokens and rewrites the guidelines through composable verbs; each
// change persists and streams over SSE so the brand preview updates live.
//
// SSE events: { type: "brand", design_md, tokens } | { type: "done" } | { type: "error", error }
app.post("/api/brands/:id/generate", async (c) => {
  const id = c.req.param("id");
  const existing = await get<Brand>("SELECT * FROM brands WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const { instruction } = await c.req.json<{ instruction?: string }>();
  if (!instruction?.trim()) return c.json({ error: "instruction is required" }, 400);
  if (!hasAiKey(c.env)) return c.json({ error: "AI isn't configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)." }, 503);

  let md = existing.design_md || DEFAULT_BRAND_MD;

  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (obj: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const persist = async () => {
    await run("UPDATE brands SET design_md = ?, updated_at = datetime('now') WHERE id = ?", [md, id]);
    await send({ type: "brand", design_md: md, tokens: parseTokens(md) });
  };

  const ops: BrandOps = {
    read: async () => md,
    updateTokens: async (patch: BrandTokensPatch) => {
      const cur = parseTokens(md);
      const merged: BrandTokens = {
        ...cur,
        ...(patch.radius !== undefined ? { radius: patch.radius } : {}),
        ...(patch.logoPosition !== undefined ? { logoPosition: patch.logoPosition } : {}),
        ...(patch.textAlign !== undefined ? { textAlign: patch.textAlign } : {}),
        colors: { ...cur.colors, ...(patch.colors || {}) },
        fonts: { ...cur.fonts, ...(patch.fonts || {}) },
        sizes: { ...cur.sizes, ...(patch.sizes || {}) },
      };
      md = setTokensInMd(md, merged);
      await persist();
    },
    editGuidelines: async (oldStr: string, newStr: string) => {
      // Surgical prose edit: replace one exact snippet. Guard the tokens block so
      // a prose edit can never corrupt the JSON (visual changes go via updateTokens).
      const block = md.match(/```[a-zA-Z]*\s*clawnify-brand[\s\S]*?```/)?.[0] ?? "";
      if (block && block.includes(oldStr)) throw new Error("that text is in the tokens block — use update_tokens for token/visual changes");
      const idx = md.indexOf(oldStr);
      if (idx === -1) throw new Error("text not found — read_brand and copy the exact snippet to replace");
      if (md.indexOf(oldStr, idx + oldStr.length) !== -1) throw new Error("that text appears more than once — include more surrounding context to make it unique");
      md = md.slice(0, idx) + newStr + md.slice(idx + oldStr.length);
      await persist();
    },
    writeGuidelines: async (markdown: string) => {
      md = setTokensInMd(markdown, parseTokens(md)); // new prose, keep current tokens
      await persist();
    },
  };

  const run$ = (async () => {
    try {
      await editBrand(c.env, { instruction: instruction.trim(), currentMd: md }, ops);
      await send({ type: "done" });
    } catch (err) {
      await send({ type: "error", error: String(err instanceof Error ? err.message : err) });
    } finally {
      scheduleSweep(c); // the logo reference may have changed
      await writer.close().catch(() => {});
    }
  })();
  try { c.executionCtx?.waitUntil(run$); } catch { /* no execution ctx in some dev paths */ }

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
});

// Full visual preview of a brand: a guidelines page (example slides + color
// palette + type scale) rendered with the brand's own tokens & fonts.
app.get("/api/brands/:id/preview", async (c) => {
  const row = await get<Brand>("SELECT * FROM brands WHERE id = ?", [c.req.param("id")]);
  const md = row?.design_md || DEFAULT_BRAND_MD;
  const tokens = parseTokens(md);
  return c.html(brandGuideHtml(row?.name || "Brand", tokens, resolveLogoForView(tokens.logo)));
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
  const baked = await bakeInfographics(row.content, { colorPrimary: tokens.colors.accent, colorBg: tokens.colors.bg });
  const content = await inlineAssets(baked);
  const html = revealDoc({
    mode: "print",
    content,
    theme: row.theme,
    brandHeadHtml: brandHead(tokens),
    brandLogoHtml: brandLogoTag(await resolveLogoForPrint(tokens.logo)),
    nav: parseNav(row.nav), // print uses only nav.slideNumber (arrows/progress are present-only)
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

// Build the print HTML for ONE slide (infographics baked, media inlined, no page
// chrome) — shared by the slide-PNG endpoint and the agent's view_slide tool.
async function slidePrintHtml(slideChunk: string, theme: string, tokens: BrandTokens): Promise<string> {
  let content = await bakeInfographics(slideChunk, { colorPrimary: tokens.colors.accent, colorBg: tokens.colors.bg });
  content = await inlineAssets(content);
  return revealDoc({
    mode: "print",
    content,
    theme,
    brandHeadHtml: brandHead(tokens),
    brandLogoHtml: brandLogoTag(await resolveLogoForPrint(tokens.logo)),
    nav: { mode: "none" },
  });
}

// Render a single slide to a PNG so an agent can SEE how its HTML came out and
// whether it rendered correctly. GET /api/decks/:id/slide/:n → image/png.
app.get("/api/decks/:id/slide/:n", async (c) => {
  const row = await get<Deck>("SELECT * FROM decks WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!c.env.CLAWNIFY_TOKEN) {
    return c.json({ error: "Slide render not configured (missing CLAWNIFY_TOKEN). Runs on deployed apps." }, 503);
  }
  const n = parseInt(c.req.param("n"), 10);
  const chunks = splitDeck(row.content);
  if (!Number.isFinite(n) || n < 0 || n >= chunks.length) {
    return c.json({ error: `No slide ${n} — deck has ${chunks.length} slide(s)` }, 404);
  }
  const tokens = parseTokens(await brandMdFor(row.brand_id));
  try {
    const html = await slidePrintHtml(chunks[n], row.theme, tokens);
    const png = await renderSlidePng(c.env.CLAWNIFY_TOKEN, html);
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (err) {
    const detail = err instanceof PdfRenderError ? err.detail || err.message : String(err);
    return c.json({ error: "slide_render_failed", detail }, 502);
  }
});

// ── Assets (media) ───────────────────────────────────────────────────
// There is no media library: an asset exists only while a slide or a brand
// logo references it (`assets/<key>`). Upload inserts a reference; removing the
// last reference makes the asset an orphan, which the sweep deletes from R2.

interface Asset {
  id: string;
  key: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
}

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

app.get("/api/uploads/:key", async (c) => {
  const obj = await getUpload(c.req.param("key"));
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.data, {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=31536000" },
  });
});

// ── deck content helpers (slides + speaker notes) ────────────────────
// A deck is one document; slides are separated by a line containing only `---`.
// Mirrors the client's splitSlides so indices line up across the wire.
function splitDeck(content: string): string[] {
  return ("\n" + content + "\n")
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*---[ \t]*\n/)
    .map((c) => c.replace(/^\n+|\n+$/g, ""))
    .filter((c) => c.trim());
}
const joinDeck = (chunks: string[]) => chunks.join("\n\n---\n\n");

// Speaker notes live inside the slide as <aside class="notes">…</aside>. They're
// the per-slide store of intent: hidden on the slide and in the PDF, shown in the
// presenter view, and read/written by the agent. We keep notes and slide markup
// separate over the tool boundary and assemble them into the chunk.
const NOTES_RE = /<aside\b[^>]*\bclass="[^"]*\bnotes\b[^"]*"[^>]*>([\s\S]*?)<\/aside>/i;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function extractNotes(chunk: string): { content: string; notes: string } {
  const m = chunk.match(NOTES_RE);
  if (!m) return { content: chunk.trim(), notes: "" };
  const notes = decodeHtml(m[1].trim());
  const content = chunk.replace(NOTES_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { content, notes };
}

function assembleChunk({ content, notes }: AuthoredSlide): string {
  const body = content.trim();
  return notes.trim() ? `${body}\n<aside class="notes">${escapeHtml(notes.trim())}</aside>` : body;
}

// ── helpers ──────────────────────────────────────────────────────────

function lower8(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ASSET_REF_RE = /assets\/([A-Za-z0-9._-]+)/g;

// Delete any asset no slide or brand logo references anymore (garbage-collect
// media removed from the deck). A short grace period spares freshly-uploaded
// assets whose reference hasn't been saved yet (the editor saves on a debounce).
async function sweepOrphanAssets(): Promise<void> {
  const stale = await query<{ id: string; key: string }>(
    "SELECT id, key FROM assets WHERE created_at < datetime('now', '-120 seconds')",
  );
  if (stale.length === 0) return;

  const used = new Set<string>();
  const collect = (s: string) => {
    for (const m of s.matchAll(ASSET_REF_RE)) used.add(m[1]);
  };
  for (const d of await query<{ content: string }>("SELECT content FROM decks")) collect(d.content);
  for (const b of await query<{ design_md: string }>("SELECT design_md FROM brands")) collect(b.design_md);

  for (const a of stale) {
    if (used.has(a.key)) continue;
    await deleteUpload(a.key);
    await run("DELETE FROM assets WHERE id = ?", [a.id]);
  }
}

// Run the sweep without blocking the response when possible.
function scheduleSweep(c: { executionCtx?: { waitUntil(p: Promise<unknown>): void } }): void {
  const p = sweepOrphanAssets().catch((e) => console.error("asset sweep failed", e));
  try {
    c.executionCtx?.waitUntil(p);
  } catch {
    /* no execution context (e.g. some dev paths) — the promise still runs */
  }
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
