import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Play,
  FileDown,
  Trash2,
  Copy,
  Presentation,
  Loader2,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Sparkles,
  Code2,
  Wand2,
  Palette,
  ArrowLeft,
  Check,
  ImagePlus,
} from "lucide-react";

// Open a file picker and upload the chosen file as an asset. Resolves to the
// stored asset (or null if cancelled).
function pickAndUpload(accept: string): Promise<Asset | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const fd = new FormData();
      fd.append("file", f);
      resolve(await fetch("/api/assets", { method: "POST", body: fd }).then((r) => r.json()));
    };
    input.click();
  });
}

// ── deck content <-> slides ──────────────────────────────────────────
function splitSlides(content: string): string[] {
  return ("\n" + content + "\n")
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*---[ \t]*\n/)
    .map((c) => c.replace(/^\n+|\n+$/g, ""))
    .filter((c) => c.trim());
}
const joinSlides = (s: string[]) => s.join("\n\n---\n\n");

// Must mirror the renderer's data-sid selector exactly (same order) so a clicked
// element maps back to the right source node.
const SEL_LIST = "div,h1,h2,h3,h4,h5,h6,p,li,blockquote,span,strong,em,code,td,th,figcaption,img";

// ── per-element / per-slide source edits (pure) ──────────────────────
function parseHtmlSlide(chunk: string): { attrs: string; body: string } {
  let rest = chunk.replace(/^\s*<!--\s*html\s*-->\s*\n?/i, "");
  let attrs = "";
  const m = rest.match(/^<!--\s*\.slide:\s*([\s\S]*?)-->\s*\n?/i);
  if (m) {
    attrs = m[1].trim();
    rest = rest.slice(m[0].length);
  }
  return { attrs, body: rest.replace(/^\n+|\n+$/g, "") };
}
const buildHtmlSlide = (attrs: string, body: string) =>
  `<!-- html -->\n${attrs ? `<!-- .slide: ${attrs} -->\n` : ""}${body}`;

function withBody(body: string, fn: (root: HTMLElement) => void): string {
  const doc = new DOMParser().parseFromString(`<body><div id="__r">${body}</div></body>`, "text/html");
  const root = doc.getElementById("__r")!;
  fn(root);
  return root.innerHTML;
}
const elBySid = (root: HTMLElement, sid: number) =>
  (root.querySelectorAll(SEL_LIST)[sid] as HTMLElement | undefined) ?? null;

const FRAG = ["fragment", "fade-up", "fade-down", "fade-left", "fade-right", "zoom-in", "grow", "shrink"];

function applyTextHtml(chunk: string, sid: number, text: string): string {
  const { attrs, body } = parseHtmlSlide(chunk);
  return buildHtmlSlide(attrs, withBody(body, (r) => {
    const el = elBySid(r, sid);
    if (el) el.textContent = text;
  }));
}
function applyAnimHtml(chunk: string, sid: number, effect: string): string {
  const { attrs, body } = parseHtmlSlide(chunk);
  return buildHtmlSlide(attrs, withBody(body, (r) => {
    const el = elBySid(r, sid);
    if (!el) return;
    el.classList.remove(...FRAG);
    if (effect === "fade") el.classList.add("fragment");
    else if (effect) el.classList.add("fragment", effect);
  }));
}
function applyImgHtml(chunk: string, sid: number, ref: string): string {
  const { attrs, body } = parseHtmlSlide(chunk);
  return buildHtmlSlide(attrs, withBody(body, (r) => {
    const el = elBySid(r, sid);
    if (el && el.tagName === "IMG") el.setAttribute("src", ref);
  }));
}
function removeElHtml(chunk: string, sid: number): string {
  const { attrs, body } = parseHtmlSlide(chunk);
  return buildHtmlSlide(attrs, withBody(body, (r) => elBySid(r, sid)?.remove()));
}
function getSlideBg(chunk: string): string | null {
  const m = chunk.match(/data-background-color="([^"]*)"/i);
  return m ? m[1] : null;
}
function setSlideBg(chunk: string, color: string | null): string {
  const commentRe = /<!--\s*\.slide:\s*([\s\S]*?)-->/i;
  const ex = chunk.match(commentRe);
  if (ex) {
    let attrs = ex[1].replace(/\s*data-background-color="[^"]*"/i, "").trim();
    if (color) attrs = `${attrs} data-background-color="${color}"`.trim();
    return attrs ? chunk.replace(commentRe, `<!-- .slide: ${attrs} -->`) : chunk.replace(commentRe, "").replace(/^\n+/, "");
  }
  if (!color) return chunk;
  const comment = `<!-- .slide: data-background-color="${color}" -->`;
  // Insert after an optional leading `<!-- html -->` marker, else prepend.
  if (/^\s*<!--\s*html\s*-->/i.test(chunk)) return chunk.replace(/(^\s*<!--\s*html\s*-->\s*\n?)/i, `$1${comment}\n`);
  return `${comment}\n${chunk}`;
}

// ── brand tokens ─────────────────────────────────────────────────────
interface BrandTokens {
  colors: { bg: string; text: string; heading: string; accent: string; muted: string };
  fonts: { heading: string; body: string; mono: string; google: string[] };
  sizes: { hero: number; body: number };
  radius: string;
  logo: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}
const LOGO_POSITIONS = [
  { v: "top-left", l: "Top left" },
  { v: "top-right", l: "Top right" },
  { v: "bottom-left", l: "Bottom left" },
  { v: "bottom-right", l: "Bottom right" },
] as const;
const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
const FONTS = [
  { name: "System sans", family: SYSTEM_SANS, google: "" },
  { name: "Inter", family: "Inter", google: "Inter:wght@400;500;600;700" },
  { name: "Space Grotesk", family: "Space Grotesk", google: "Space+Grotesk:wght@500;700" },
  { name: "Poppins", family: "Poppins", google: "Poppins:wght@400;600;700" },
  { name: "Montserrat", family: "Montserrat", google: "Montserrat:wght@500;700" },
  { name: "Roboto", family: "Roboto", google: "Roboto:wght@400;500;700" },
  { name: "Playfair Display", family: "Playfair Display", google: "Playfair+Display:wght@500;700" },
  { name: "Georgia", family: "Georgia, serif", google: "" },
];
const nameOfFamily = (f: string) => FONTS.find((x) => x.family === f)?.name ?? "System sans";
const fontByName = (n: string) => FONTS.find((x) => x.name === n) ?? FONTS[0];

const ANIMS = [
  { v: "none", l: "None" },
  { v: "fade", l: "Fade in" },
  { v: "fade-up", l: "Fade up" },
  { v: "fade-down", l: "Fade down" },
  { v: "fade-left", l: "Fade left" },
  { v: "fade-right", l: "Fade right" },
  { v: "zoom-in", l: "Zoom in" },
  { v: "grow", l: "Grow" },
];

interface Deck { id: string; title: string; content: string; nav: string; updated_at: string }
interface Asset { id: string; key: string; name: string; content_type: string }
interface SlideTemplate { id: string; name: string; body: string }
interface Nav { arrows: boolean; progress: boolean; slideNumber: boolean }
interface SelEl { sid: number; tag: string; anim: string; text: string }

// A designed (HTML) slide wrapper using the brand CSS variables. Slides are
// always HTML — markdown is not supported.
const designedSlide = (inner: string) =>
  `<!-- html -->\n<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;padding:0 9%;box-sizing:border-box">\n${inner}\n</div>`;
const BLANK_SLIDE = designedSlide(
  `  <h2 style="font:700 60px/1.05 var(--r-heading-font);margin:0;color:var(--brand-heading)">New slide</h2>\n  <p style="font:400 var(--brand-body-size)/1.5 var(--r-main-font);color:var(--brand-text);margin-top:18px;max-width:80%">Click to edit, or use the prompt below.</p>`,
);
const FALLBACK_STARTER = designedSlide(
  `  <div class="kicker" style="font-size:24px">Your kicker</div>\n  <h1 style="font:700 var(--brand-hero-size)/1.02 var(--r-heading-font);margin:14px 0 0;color:var(--brand-heading)">Your presentation</h1>\n  <p style="font:400 var(--brand-body-size)/1.4 var(--r-main-font);color:var(--brand-muted);max-width:72%;margin-top:18px">A supporting subtitle that sets the scene in one clear line.</p>`,
);

export function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [templates, setTemplates] = useState<SlideTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [slides, setSlides] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [nav, setNav] = useState<Nav>({ arrows: true, progress: true, slideNumber: true });

  // brand library
  const [brands, setBrands] = useState<{ id: string; name: string; tokens: BrandTokens }[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<BrandTokens | null>(null);
  const [page, setPage] = useState<"deck" | "brands">("deck");
  const [editorBrandId, setEditorBrandId] = useState<string | null>(null);

  const [selEl, setSelEl] = useState<SelEl | null>(null);
  const [bottomTab, setBottomTab] = useState<"prompt" | "code">("prompt");
  const [prompt, setPrompt] = useState("");
  const [genLoading, setGenLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [decksOpen, setDecksOpen] = useState(false);

  const canvasRef = useRef<HTMLIFrameElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rendered = useRef("");

  const selected = decks.find((d) => d.id === selectedId) ?? null;
  const content = joinSlides(slides);

  // ── loading ──
  const loadDecks = useCallback(async () => {
    const rows: Deck[] = await fetch("/api/decks").then((r) => r.json());
    setDecks(rows);
    return rows;
  }, []);

  const loadBrands = useCallback(async () => {
    const rows: { id: string; name: string; tokens: BrandTokens }[] = await fetch("/api/brands").then((r) => r.json());
    setBrands(rows);
    return rows;
  }, []);

  useEffect(() => {
    loadBrands();
    loadDecks().then((rows) => rows.length && selectDeck(rows[0]));
    fetch("/api/templates").then((r) => r.json() as Promise<SlideTemplate[]>).then(setTemplates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Design inspector edits the deck's active brand.
  const activeBrandId = brandId ?? brands[0]?.id ?? null;
  useEffect(() => {
    setTokens(brands.find((b) => b.id === activeBrandId)?.tokens ?? null);
  }, [brands, activeBrandId]);
  const activeBrandName = brands.find((b) => b.id === activeBrandId)?.name ?? "Brand";

  // canvas → editor messages
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data || {};
      if (m.source !== "slides-preview") return;
      if (m.type === "slidechanged") { setSel(m.h ?? 0); setSelEl(null); }
      else if (m.type === "bg-click") setSelEl(null);
      else if (m.type === "el-select") setSelEl({ sid: m.sid, tag: m.tag, anim: m.anim, text: m.text });
      else if (m.type === "el-edit") onElEdit(m.sid, m.oldText, m.newText);
      else if (m.type === "img-click") onImgClick(m.sid, m.src);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refs so the (once-bound) message handler reads fresh state
  const slidesRef = useRef<string[]>([]);
  const selRef = useRef(0);
  useEffect(() => { slidesRef.current = slides; }, [slides]);
  useEffect(() => { selRef.current = sel; }, [sel]);

  // The canvas src must NOT depend on `sel`: slide navigation goes through
  // postMessage (gotoSlide), so reacting to `sel` here would reload the iframe on
  // every move and flash slide 1. It reloads only when the deck/brand changes
  // (viewKey), restoring the current slide via the h= param captured at that moment.
  const canvasSrc = useMemo(
    () => (selectedId ? `/api/decks/${selectedId}/view?h=${selRef.current}&t=${viewKey}` : ""),
    [selectedId, viewKey],
  );

  function selectDeck(d: Deck) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSelectedId(d.id);
    setTitle(d.title);
    const s = splitSlides(d.content);
    setSlides(s.length ? s : [""]);
    setSel(0);
    selRef.current = 0; // keep the canvasSrc memo from restoring the prior deck's slide
    setSelEl(null);
    try { setNav({ arrows: true, progress: true, slideNumber: true, ...JSON.parse(d.nav || "{}") }); } catch { /* default */ }
    rendered.current = d.content;
    setViewKey((k) => k + 1);
    setDecksOpen(false);
    setPage("deck");
  }

  // ── save ──
  function scheduleSave(next: string[], t = title, n = nav) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(next, t, n), 500);
  }
  async function save(next = slides, t = title, n = nav) {
    if (!selectedId) return;
    const body = { title: t, content: joinSlides(next), nav: JSON.stringify(n) };
    setSaving(true);
    const up: Deck = await fetch(`/api/decks/${selectedId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => r.json());
    setDecks((ds) => ds.map((d) => (d.id === up.id ? up : d)));
    setSaving(false);
    if (body.content !== rendered.current) { rendered.current = body.content; setViewKey((k) => k + 1); }
  }
  function applyToSlide(i: number, fn: (c: string) => string) {
    const next = slides.slice();
    next[i] = fn(next[i] ?? "");
    setSlides(next);
    scheduleSave(next);
  }
  function setSlidesAndSave(next: string[]) { setSlides(next); scheduleSave(next); }

  // ── click-to-edit write-backs ──
  function onElEdit(sid: number, _oldText: string, newText: string) {
    const i = selRef.current;
    const chunk = slidesRef.current[i] ?? "";
    applyToSlide(i, () => applyTextHtml(chunk, sid, newText));
  }
  async function onImgClick(sid: number, _src: string) {
    const a = await pickAndUpload("image/*");
    if (!a) return;
    const i = selRef.current; const chunk = slidesRef.current[i] ?? "";
    applyToSlide(i, () => applyImgHtml(chunk, sid, `assets/${a.key}`));
  }
  // Upload a new image/video and add it to the current slide.
  async function addMedia() {
    const a = await pickAndUpload("image/*,video/*");
    if (!a) return;
    const ref = `assets/${a.key}`;
    const isVideo = (a.content_type || "").startsWith("video/");
    const i = sel; const chunk = slides[i] ?? "";
    const { attrs, body } = parseHtmlSlide(chunk);
    const tag = isVideo
      ? `<video controls src="${ref}" style="max-width:100%;border-radius:var(--brand-radius)"></video>`
      : `<img src="${ref}" alt="" style="max-width:100%;border-radius:var(--brand-radius)" />`;
    applyToSlide(i, () => buildHtmlSlide(attrs, `${body}\n${tag}`));
  }
  function setAnim(effect: string) {
    if (!selEl) return;
    setSelEl({ ...selEl, anim: effect });
    const i = sel; const chunk = slides[i] ?? "";
    applyToSlide(i, () => applyAnimHtml(chunk, selEl.sid, effect === "none" ? "" : effect));
  }
  function deleteSelEl() {
    if (!selEl) return;
    applyToSlide(sel, (c) => removeElHtml(c, selEl.sid));
    setSelEl(null);
  }

  // ── background popover ──
  const currentBg = getSlideBg(slides[sel] ?? "") ?? tokens?.colors.bg ?? "#000000";
  function changeBg(color: string | null) {
    applyToSlide(sel, (c) => setSlideBg(c, color));
  }

  // ── slide ops ──
  function gotoSlide(i: number) {
    setSel(i); setSelEl(null);
    canvasRef.current?.contentWindow?.postMessage({ target: "slides-view", type: "goto", h: i }, "*");
  }
  function addSlide(body: string) {
    setAddOpen(false);
    const next = slides.slice(); next.splice(sel + 1, 0, body);
    setSel(sel + 1); setSlidesAndSave(next);
  }
  function duplicateSlide(i: number) {
    const next = slides.slice(); next.splice(i + 1, 0, slides[i]);
    setSel(i + 1); setSlidesAndSave(next);
  }
  function moveSlide(i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= slides.length) return;
    const next = slides.slice(); [next[i], next[j]] = [next[j], next[i]];
    setSel(j); setSlidesAndSave(next);
  }
  function deleteSlide(i: number) {
    if (slides.length <= 1) return;
    const next = slides.slice(); next.splice(i, 1);
    setSel(Math.max(0, Math.min(i, next.length - 1))); setSlidesAndSave(next);
  }

  // New decks start from designed slides (Title + Title-and-bullets), or a single
  // fallback slide if the templates haven't loaded yet.
  function starterContent() {
    const pick = (id: string) => templates.find((t) => t.id === id)?.body;
    const bodies = [pick("title"), pick("bullets")].filter(Boolean) as string[];
    return bodies.length ? bodies.join("\n\n---\n\n") : FALLBACK_STARTER;
  }

  // ── decks ──
  async function newDeck() {
    const created: Deck = await fetch("/api/decks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled deck", content: starterContent() }),
    }).then((r) => r.json());
    setDecks((ds) => [created, ...ds]); selectDeck(created);
  }
  async function deleteDeck(id: string) {
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    const rows = await loadDecks();
    if (id === selectedId) rows.length ? selectDeck(rows[0]) : (setSelectedId(null), setSlides([]));
  }
  // Start a brand-new deck that uses the given brand.
  async function newDeckWithBrand(id: string) {
    const created: Deck = await fetch("/api/decks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled deck", content: starterContent(), brand_id: id }),
    }).then((r) => r.json());
    setDecks((ds) => [created, ...ds]);
    selectDeck(created);
  }

  // ── present + export ──
  const present = () => canvasRef.current?.requestFullscreen?.();
  async function exportPdf() {
    if (!selectedId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/decks/${selectedId}/pdf`);
      if (!res.ok) { const m: any = await res.json().catch(() => ({})); alert(`Export failed: ${m.detail || m.error || res.status}`); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url;
      a.download = `${(title || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  // ── AI generate ──
  async function runGenerate() {
    if (!prompt.trim() || genLoading) return;
    setGenLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, current_slide: slides[sel], deck_context: content }),
      });
      const data: any = await res.json();
      if (!res.ok) { alert(data.error || "Generation failed"); return; }
      const out: string = data.content || "";
      // The model decides whether to edit this slide, add slides, or rebuild.
      if (data.action === "replace_deck") {
        const s = splitSlides(out); setSel(0); setSlidesAndSave(s.length ? s : [out]);
      } else if (data.action === "edit_current") {
        applyToSlide(sel, () => out);
      } else {
        const gen = splitSlides(out); const next = slides.slice(); next.splice(sel + 1, 0, ...gen);
        setSel(sel + 1); setSlidesAndSave(next);
      }
      setPrompt("");
    } finally { setGenLoading(false); }
  }

  // ── brand inspector ──
  function patchBrand(mut: (t: BrandTokens) => BrandTokens) {
    if (!tokens || !activeBrandId) return;
    const next = mut(structuredClone(tokens));
    setTokens(next);
    setBrands((bs) => bs.map((b) => (b.id === activeBrandId ? { ...b, tokens: next } : b)));
    if (brandTimer.current) clearTimeout(brandTimer.current);
    brandTimer.current = setTimeout(async () => {
      await fetch(`/api/brands/${activeBrandId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: next }) });
      setViewKey((k) => k + 1);
    }, 300);
  }

  // pick which brand the current deck uses
  async function useBrandForDeck(id: string) {
    if (!selectedId) return;
    setBrandId(id);
    setPage("deck");
    setEditorBrandId(null);
    await fetch(`/api/decks/${selectedId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_id: id }) });
    setViewKey((k) => k + 1);
  }
  async function createBrand() {
    const b: { id: string } = await fetch("/api/brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "New brand" }) }).then((r) => r.json());
    await loadBrands();
    setEditorBrandId(b.id);
  }
  function setFont(role: "heading" | "body", name: string) {
    const f = fontByName(name);
    patchBrand((t) => {
      t.fonts[role] = f.family;
      t.fonts.google = [...new Set([fontByName(nameOfFamily(t.fonts.heading)).google, fontByName(nameOfFamily(t.fonts.body)).google].filter(Boolean))];
      return t;
    });
  }
  function setNavOpt(k: keyof Nav, v: boolean) {
    const n = { ...nav, [k]: v }; setNav(n); save(slides, title, n);
  }

  const radiusPx = tokens ? parseInt(tokens.radius) || 0 : 12;

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-white"><Presentation size={15} /></span>
        <div className="relative">
          <button onClick={() => setDecksOpen((o) => !o)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-neutral-100">
            {title || "Open Slides"} <ChevronDown size={14} className="text-neutral-400" />
          </button>
          {decksOpen && (
            <div className="absolute left-0 z-30 mt-1 w-60 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
              <button onClick={newDeck} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-100"><Plus size={14} /> New deck</button>
              <div className="my-1 border-t border-neutral-100" />
              {decks.map((d) => (
                <div key={d.id} className={`group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50 ${d.id === selectedId ? "font-medium" : ""}`}>
                  <button onClick={() => selectDeck(d)} className="flex-1 truncate text-left">{d.title || "Untitled"}</button>
                  <button onClick={() => deleteDeck(d.id)} className="hidden text-neutral-400 hover:text-red-500 group-hover:block"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <input value={title} onChange={(e) => { setTitle(e.target.value); scheduleSave(slides, e.target.value); }}
            className="ml-1 w-44 rounded px-2 py-1 text-sm text-neutral-500 outline-none hover:bg-neutral-100 focus:bg-neutral-100" placeholder="Deck title" />
        )}
        <div className="flex-1" />
        <span className="mr-1 text-xs text-neutral-400">{saving ? "Saving…" : selected ? `${slides.length} slides` : ""}</span>
        <button onClick={() => setPage(page === "brands" ? "deck" : "brands")} className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm ${page === "brands" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 hover:bg-neutral-50"}`}>
          <Palette size={14} /> Brands
        </button>
        <button onClick={exportPdf} disabled={!selected || exporting} className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50 disabled:opacity-40">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
        </button>
        <button onClick={present} disabled={!selected} className="flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
          <Play size={14} /> Present
        </button>
      </header>

      {page === "brands" ? (
        editorBrandId ? (
          <BrandEditor
            brandId={editorBrandId}
            active={editorBrandId === activeBrandId}
            onBack={() => setEditorBrandId(null)}
            onChanged={loadBrands}
            onUse={() => newDeckWithBrand(editorBrandId)}
            onDeleted={async () => { setEditorBrandId(null); const rows = await loadBrands(); if (!rows.find((b) => b.id === brandId)) setBrandId(rows[0]?.id ?? null); setViewKey((k) => k + 1); }}
          />
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
            <div className="mx-auto max-w-5xl px-8 py-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold">Brand library</h1>
                  <p className="text-sm text-neutral-500">Design systems your decks can use. Click one to preview and edit.</p>
                </div>
                <button onClick={createBrand} className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"><Plus size={15} /> New brand</button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {brands.map((b) => (
                  <BrandCard key={b.id} brand={b} active={b.id === activeBrandId} onUse={() => newDeckWithBrand(b.id)} onEdit={() => setEditorBrandId(b.id)} />
                ))}
              </div>
            </div>
          </main>
        )
      ) : selected ? (
        <div className="flex min-h-0 flex-1">
          {/* Pages */}
          <aside className="flex w-48 shrink-0 flex-col border-r border-neutral-200 bg-white">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Pages</div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-2">
              {slides.map((s, i) => (
                <div key={i} className="group relative">
                  <button onClick={() => gotoSlide(i)} style={{ aspectRatio: "16 / 9" }}
                    className={`block w-full overflow-hidden rounded-md border bg-neutral-900 text-left ${i === sel ? "border-neutral-900 ring-2 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"}`}>
                    <iframe key={viewKey} src={`/api/decks/${selected.id}/view?only=${i}&thumb=1&t=${viewKey}`} title={`Slide ${i + 1}`} tabIndex={-1} scrolling="no" className="pointer-events-none h-full w-full border-0" />
                  </button>
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">{String(i + 1).padStart(2, "0")}</span>
                  <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                    <IconMini onClick={() => moveSlide(i, -1)}><ChevronUp size={12} /></IconMini>
                    <IconMini onClick={() => moveSlide(i, 1)}><ChevronDown size={12} /></IconMini>
                    <IconMini onClick={() => duplicateSlide(i)} title="Duplicate"><Copy size={12} /></IconMini>
                    <IconMini onClick={() => deleteSlide(i)} danger><Trash2 size={12} /></IconMini>
                  </div>
                </div>
              ))}
            </div>
            <div className="relative border-t border-neutral-200 p-2">
              <button onClick={() => setAddOpen((o) => !o)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-300 py-2 text-sm text-neutral-600 hover:bg-neutral-50"><Plus size={15} /> Add slide</button>
              {addOpen && (
                <div className="absolute bottom-12 left-2 right-2 z-30 max-h-72 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Designed</div>
                  {templates.map((t) => (<button key={t.id} onClick={() => addSlide(t.body)} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100">{t.name}</button>))}
                  <div className="my-1 border-t border-neutral-100" />
                  <button onClick={() => addSlide(BLANK_SLIDE)} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100">Blank slide</button>
                </div>
              )}
            </div>
          </aside>

          {/* canvas + prompt/code */}
          <main className="flex min-w-0 flex-1 flex-col bg-neutral-100">
            {/* Always present the canvas as the largest 16:9 box that fits the
                available space (container-query units), so it never stretches with
                the window — only the letterbox around it grows. */}
            <div className="flex min-h-0 flex-1 items-center justify-center p-3" style={{ containerType: "size" }}>
              <div style={{ width: "min(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" }}>
                <iframe key={viewKey} ref={canvasRef} src={canvasSrc} title="Canvas" allowFullScreen className="h-full w-full rounded-lg border border-neutral-200 bg-white shadow-sm" />
              </div>
            </div>
            <div className="flex h-44 shrink-0 flex-col border-t border-neutral-200 bg-white">
              <div className="flex items-center gap-1 px-3 pt-2">
                <Tab active={bottomTab === "prompt"} onClick={() => setBottomTab("prompt")}><Sparkles size={13} /> Prompt</Tab>
                <Tab active={bottomTab === "code"} onClick={() => setBottomTab("code")}><Code2 size={13} /> Code</Tab>
                <div className="flex-1" />
                <span className="text-[11px] text-neutral-400">Tip: click any text, image or background on the slide to edit it</span>
              </div>
              {bottomTab === "prompt" ? (
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runGenerate(); }}
                    placeholder="Describe what to make — e.g. “a 3-slide intro for our Q3 launch, bold and confident”"
                    className="flex-1 resize-none rounded-md border border-neutral-200 p-2.5 text-sm outline-none focus:border-neutral-400" />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">Edits this slide, adds slides, or builds a deck — based on what you ask. ⌘↵</span>
                    <div className="flex-1" />
                    <button onClick={runGenerate} disabled={genLoading || !prompt.trim()} className="flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
                      {genLoading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Generate
                    </button>
                  </div>
                </div>
              ) : (
                <textarea value={slides[sel] ?? ""} onChange={(e) => applyToSlide(sel, () => e.target.value)} spellCheck={false}
                  placeholder="Edit this slide's HTML"
                  className="flex-1 resize-none px-3 pb-3 font-mono text-[12.5px] leading-relaxed outline-none" />
              )}
            </div>
          </main>

          {/* Design inspector */}
          <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
            <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium"><SlidersHorizontal size={15} /> Design</div>
            <div className="px-4 pb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Brand</div>
              <div className="flex items-center gap-2">
                <select value={activeBrandId ?? ""} onChange={(e) => useBrandForDeck(e.target.value)} className="h-8 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-sm">
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button onClick={() => setPage("brands")} title="Brand library" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-200 hover:bg-neutral-50"><Palette size={14} /></button>
              </div>
            </div>

            <div className="px-4 pb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Media</div>
              <button onClick={addMedia} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-300 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
                <ImagePlus size={15} /> Add image or video
              </button>
              <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">Added to this slide. Click an image on the slide to replace it; delete it from the slide to remove it for good.</p>
            </div>

            <div className="px-4 pb-6">
              {selEl ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Element · {selEl.tag.toLowerCase()}</span>
                    <button onClick={deleteSelEl} className="text-neutral-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </div>
                  <SelectRow label="Animate in" value={selEl.anim} options={ANIMS.map((a) => a.l)}
                    onChange={(l) => setAnim(ANIMS.find((a) => a.l === l)!.v)} valueToLabel={(v) => ANIMS.find((a) => a.v === v)?.l ?? "None"} />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Background</div>
                  <ColorRow label="Slide color" value={currentBg} onChange={(v) => changeBg(v)} />
                  <button onClick={() => changeBg(null)} className="text-xs text-neutral-400 hover:text-neutral-600">Reset to brand</button>
                  <div className="border-t border-neutral-200 pt-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Navigation</div>
                    <div className="space-y-2">
                      <ToggleRow label="Arrows" value={nav.arrows} onChange={(v) => setNavOpt("arrows", v)} />
                      <ToggleRow label="Progress bar" value={nav.progress} onChange={(v) => setNavOpt("progress", v)} />
                      <ToggleRow label="Page numbers" value={nav.slideNumber} onChange={(v) => setNavOpt("slideNumber", v)} />
                    </div>
                    <p className="mt-2 text-[10px] leading-snug text-neutral-400">Arrows &amp; progress bar show only while presenting. Page numbers also appear in the exported PDF.</p>
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] leading-snug text-neutral-400">Click any text or image on the slide to edit it, or the background for slide settings.</p>
            </div>
          </aside>
        </div>
      ) : (
        <main className="grid flex-1 place-items-center text-neutral-400">
          <div className="text-center">
            <Presentation size={32} className="mx-auto mb-3 opacity-40" />
            <button onClick={newDeck} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">Create your first deck</button>
          </div>
        </main>
      )}

    </div>
  );
}

// ── brand library card ──
const resolveLogo = (logo: string) => (logo.startsWith("assets/") ? `/api/uploads/${logo.slice("assets/".length)}` : logo);
function familyCss(f: string) { return /[, ]/.test(f) ? f : `'${f}'`; }
function BrandCard({ brand, active, onUse, onEdit }: { brand: { id: string; name: string; tokens: BrandTokens }; active: boolean; onUse: () => void; onEdit: () => void }) {
  const t = brand.tokens;
  return (
    <div className={`overflow-hidden rounded-lg border ${active ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"}`}>
      <button onClick={onEdit} className="block w-full text-left">
        <div style={{ background: t.colors.bg }} className="flex h-28 flex-col justify-center px-4">
          <div style={{ color: t.colors.accent }} className="text-[10px] font-semibold uppercase tracking-widest">Brand</div>
          <div style={{ color: t.colors.heading, fontFamily: familyCss(t.fonts.heading) }} className="truncate text-xl font-bold">{brand.name}</div>
          <div style={{ color: t.colors.muted, fontFamily: familyCss(t.fonts.body) }} className="truncate text-xs">The quick brown fox jumps</div>
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-neutral-100 px-3 py-2">
        <div className="flex gap-1">
          {[t.colors.bg, t.colors.text, t.colors.accent].map((c, i) => (<span key={i} style={{ background: c }} className="h-3.5 w-3.5 rounded-full border border-neutral-200" />))}
        </div>
        <div className="flex items-center gap-2">
          {active && <span className="flex items-center gap-1 text-xs text-green-600"><Check size={12} /> In use</span>}
          <button onClick={onUse} className="rounded border border-neutral-200 px-2 py-0.5 text-xs hover:bg-neutral-50">New deck</button>
          <button onClick={onEdit} className="text-xs text-neutral-500 hover:text-neutral-900">Edit</button>
        </div>
      </div>
    </div>
  );
}

// ── brand editor (preview + name + prompt + DESIGN.md) ──
function BrandEditor({ brandId, active, onBack, onChanged, onUse, onDeleted }: {
  brandId: string; active: boolean; onBack: () => void; onChanged: () => void; onUse: () => void; onDeleted: () => void;
}) {
  const [name, setName] = useState("");
  const [md, setMd] = useState("");
  const [tokens, setTokens] = useState<BrandTokens | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [pk, setPk] = useState(0);
  const tmr = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/brands/${brandId}`).then((r) => r.json()).then((b: any) => { setName(b.name); setMd(b.design_md); setTokens(b.tokens); });
  }, [brandId]);

  async function put(body: any) {
    const b: any = await fetch(`/api/brands/${brandId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (b.design_md != null) setMd(b.design_md);
    if (b.tokens) setTokens(b.tokens);
    onChanged(); setPk((k) => k + 1);
  }
  function patchTokens(mut: (t: BrandTokens) => BrandTokens) {
    if (!tokens) return;
    const next = mut(structuredClone(tokens)); setTokens(next);
    if (tmr.current) clearTimeout(tmr.current);
    tmr.current = setTimeout(() => put({ tokens: next }), 300);
  }
  function setFont(role: "heading" | "body", n: string) {
    const f = fontByName(n);
    patchTokens((t) => { t.fonts[role] = f.family; t.fonts.google = [...new Set([fontByName(nameOfFamily(t.fonts.heading)).google, fontByName(nameOfFamily(t.fonts.body)).google].filter(Boolean))]; return t; });
  }
  async function applyPrompt() {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction }) });
      const b: any = await res.json();
      if (!res.ok) { alert(b.error || "Failed"); return; }
      setMd(b.design_md); setTokens(b.tokens); setInstruction(""); onChanged(); setPk((k) => k + 1);
    } finally { setBusy(false); }
  }
  async function del() {
    if (!confirm("Delete this brand?")) return;
    await fetch(`/api/brands/${brandId}`, { method: "DELETE" });
    onDeleted();
  }
  const radiusPx = tokens ? parseInt(tokens.radius) || 0 : 12;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-neutral-200 px-5 py-2.5">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft size={15} /> Library</button>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => put({ name })} className="ml-1 w-56 rounded px-2 py-1 text-sm font-medium outline-none hover:bg-neutral-100 focus:bg-neutral-100" placeholder="Brand name" />
        <div className="flex-1" />
        {active && <span className="flex items-center gap-1 text-xs text-green-600"><Check size={13} /> In use on current deck</span>}
        <button onClick={del} className="text-xs text-neutral-400 hover:text-red-500">Delete</button>
        <button onClick={onUse} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Use for new slides</button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* preview */}
        <div className="min-h-0 flex-1 bg-neutral-100 p-4">
          <iframe key={pk} src={`/api/brands/${brandId}/preview?t=${pk}`} title="Brand preview" className="h-full w-full rounded-lg border border-neutral-200 bg-white" />
        </div>
        {/* controls */}
        <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-200">
          {tokens && (
            <div className="space-y-5 p-4">
              <Group label="Colors">
                <ColorRow label="Background" value={tokens.colors.bg} onChange={(v) => patchTokens((t) => ((t.colors.bg = v), t))} />
                <ColorRow label="Text" value={tokens.colors.text} onChange={(v) => patchTokens((t) => ((t.colors.text = v), (t.colors.heading = v), t))} />
                <ColorRow label="Accent" value={tokens.colors.accent} onChange={(v) => patchTokens((t) => ((t.colors.accent = v), t))} />
              </Group>
              <Group label="Typography">
                <SelectRow label="Display" value={nameOfFamily(tokens.fonts.heading)} options={FONTS.map((f) => f.name)} onChange={(v) => setFont("heading", v)} />
                <SelectRow label="Body" value={nameOfFamily(tokens.fonts.body)} options={FONTS.map((f) => f.name)} onChange={(v) => setFont("body", v)} />
                <SliderRow label="Hero" value={tokens.sizes.hero} min={60} max={200} unit="px" onChange={(v) => patchTokens((t) => ((t.sizes.hero = v), t))} />
                <SliderRow label="Body" value={tokens.sizes.body} min={18} max={48} unit="px" onChange={(v) => patchTokens((t) => ((t.sizes.body = v), t))} />
              </Group>
              <Group label="Shape">
                <SliderRow label="Radius" value={radiusPx} min={0} max={32} unit="px" onChange={(v) => patchTokens((t) => ((t.radius = `${v}px`), t))} />
              </Group>
              <Group label="Logo">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
                    {tokens.logo
                      ? <img src={resolveLogo(tokens.logo)} alt="" className="max-h-10 max-w-[72px] object-contain" />
                      : <span className="text-[10px] text-neutral-400">None</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button onClick={async () => { const a = await pickAndUpload("image/*"); if (a) patchTokens((t) => ((t.logo = `assets/${a.key}`), t)); }}
                      className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50">Upload logo</button>
                    {tokens.logo && <button onClick={() => patchTokens((t) => ((t.logo = ""), t))} className="text-left text-xs text-neutral-400 hover:text-red-500">Remove</button>}
                  </div>
                </div>
                {tokens.logo && (
                  <SelectRow label="Position" value={tokens.logoPosition}
                    options={LOGO_POSITIONS.map((p) => p.l)}
                    onChange={(l) => patchTokens((t) => ((t.logoPosition = LOGO_POSITIONS.find((p) => p.l === l)!.v), t))}
                    valueToLabel={(v) => LOGO_POSITIONS.find((p) => p.v === v)?.l ?? "Bottom right"} />
                )}
                <p className="text-[11px] leading-snug text-neutral-400">Shown in the chosen corner of every slide and in the exported PDF.</p>
              </Group>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Refine by prompt</div>
                <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") applyPrompt(); }}
                  placeholder="e.g. “darker and more playful, serif display font”" className="h-16 w-full resize-none rounded-md border border-neutral-200 p-2 text-sm outline-none focus:border-neutral-400" />
                <button onClick={applyPrompt} disabled={busy || !instruction.trim()} className="mt-1.5 flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Apply
                </button>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><Code2 size={12} /> DESIGN.md</div>
                <textarea value={md} onChange={(e) => setMd(e.target.value)} onBlur={() => put({ design_md: md })} spellCheck={false} className="h-64 w-full resize-none rounded-md border border-neutral-200 p-2 font-mono text-[11px] leading-relaxed outline-none focus:border-neutral-400" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── helpers ──
function IconMini({ onClick, children, danger, title }: { onClick: () => void; children: React.ReactNode; danger?: boolean; title?: string }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={title} className={`rounded bg-white/90 p-0.5 text-neutral-600 ${danger ? "hover:text-red-500" : "hover:text-neutral-900"}`}>{children}</button>;
}
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${active ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>{children}</button>;
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</div><div className="space-y-2">{children}</div></div>;
}
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm text-neutral-600">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-7 cursor-pointer rounded border border-neutral-200 bg-white p-0.5" />
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-20 rounded border border-neutral-200 px-1.5 py-1 text-xs uppercase outline-none" />
    </div>
  );
}
function SelectRow({ label, value, options, onChange, valueToLabel }: { label: string; value: string; options: string[]; onChange: (v: string) => void; valueToLabel?: (v: string) => string }) {
  const shown = valueToLabel ? valueToLabel(value) : value;
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm text-neutral-600">{label}</span>
      <select value={shown} onChange={(e) => onChange(e.target.value)} className="w-36 rounded border border-neutral-200 px-1.5 py-1 text-xs outline-none">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function SliderRow({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm text-neutral-600">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value))} className="w-24 accent-neutral-900" />
      <span className="w-12 text-right text-xs tabular-nums text-neutral-500">{value}{unit}</span>
    </div>
  );
}
function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center gap-2">
      <span className="flex-1 text-left text-sm text-neutral-600">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${value ? "bg-neutral-900" : "bg-neutral-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${value ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
