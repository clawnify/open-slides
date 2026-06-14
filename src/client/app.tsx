import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Play,
  FileDown,
  Trash2,
  ImagePlus,
  Presentation,
  Loader2,
} from "lucide-react";

const THEMES = [
  "white",
  "black",
  "league",
  "beige",
  "sky",
  "night",
  "serif",
  "simple",
  "solarized",
  "moon",
  "dracula",
  "blood",
];

const STARTER_MD = `# Your Presentation
### A subtitle goes here

Press **Space** or → to advance.

---

## Agenda

- Where we are
- What we're building
- What's next

---

## One idea per slide

Keep it short. Let the words breathe.

> "Simplicity is the ultimate sophistication."

---

## Code looks great too

\`\`\`ts
export function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

---

## Thank you

Questions?

Note: Speaker notes show in the speaker view — press **S** while presenting.`;

interface Deck {
  id: string;
  title: string;
  content: string;
  theme: string;
  updated_at: string;
}

interface Asset {
  id: string;
  key: string;
  name: string;
  content_type: string;
}

export function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Editing buffer for the selected deck.
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [theme, setTheme] = useState("white");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // viewKey forces the preview iframe to reload (busts cache, re-renders slides).
  const [viewKey, setViewKey] = useState(0);
  const pos = useRef({ h: 0, v: 0 }); // current slide, kept across reloads
  const rendered = useRef({ content: "", theme: "" }); // what the iframe last showed

  const previewRef = useRef<HTMLIFrameElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = decks.find((d) => d.id === selectedId) ?? null;

  // ── data loading ───────────────────────────────────────────────────
  const loadDecks = useCallback(async () => {
    const rows: Deck[] = await fetch("/api/decks").then((r) => r.json());
    setDecks(rows);
    return rows;
  }, []);

  const loadAssets = useCallback(async () => {
    const rows: Asset[] = await fetch("/api/assets").then((r) => r.json());
    setAssets(rows);
  }, []);

  useEffect(() => {
    loadDecks().then((rows) => {
      if (rows.length) selectDeck(rows[0]);
    });
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the presented slide so edit-reloads don't jump back to slide 1.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data || {};
      if (m.source !== "slides-preview") return;
      if (m.type === "slidechanged") pos.current = { h: m.h ?? 0, v: m.v ?? 0 };
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  function selectDeck(d: Deck) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSelectedId(d.id);
    setTitle(d.title);
    setContent(d.content);
    setTheme(d.theme);
    pos.current = { h: 0, v: 0 };
    rendered.current = { content: d.content, theme: d.theme };
    setViewKey((k) => k + 1);
  }

  // ── editing + debounced save ───────────────────────────────────────
  function edit(next: Partial<{ title: string; content: string; theme: string }>) {
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    if (next.theme !== undefined) setTheme(next.theme);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 600);
  }

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    const body = { title, content, theme };
    const updated: Deck = await fetch(`/api/decks/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    setDecks((ds) => ds.map((d) => (d.id === updated.id ? updated : d)));
    setSaving(false);
    // Only reload the preview when something that affects the slides changed.
    if (content !== rendered.current.content || theme !== rendered.current.theme) {
      rendered.current = { content, theme };
      setViewKey((k) => k + 1);
    }
  }

  async function newDeck() {
    const created: Deck = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled deck", content: STARTER_MD, theme: "white" }),
    }).then((r) => r.json());
    setDecks((ds) => [created, ...ds]);
    selectDeck(created);
  }

  async function deleteDeck(id: string) {
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    const rows = await loadDecks();
    if (id === selectedId) {
      if (rows.length) selectDeck(rows[0]);
      else {
        setSelectedId(null);
        setTitle("");
        setContent("");
      }
    }
  }

  // ── present + export ───────────────────────────────────────────────
  function present() {
    previewRef.current?.requestFullscreen?.();
  }

  async function exportPdf() {
    if (!selectedId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/decks/${selectedId}/pdf`);
      if (!res.ok) {
        const msg: any = await res.json().catch(() => ({}));
        alert(`Export failed: ${msg.detail || msg.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  // ── media ──────────────────────────────────────────────────────────
  async function uploadImage(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    await fetch("/api/assets", { method: "POST", body: fd });
    await loadAssets();
  }

  function insertImage(a: Asset) {
    const snippet = `![${a.name}](assets/${a.key})`;
    const ta = textareaRef.current;
    if (!ta) {
      edit({ content: `${content}\n\n${snippet}` });
      return;
    }
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = content.slice(0, start) + snippet + content.slice(end);
    edit({ content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
    });
  }

  const slideCount = content
    .split("\n")
    .filter((l) => l.trim() === "---").length + (content.trim() ? 1 : 0);

  // ── render ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      {/* top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-white">
            <Presentation size={16} />
          </span>
          Open Slides
        </div>
        <div className="flex-1" />
        {selected && (
          <>
            <span className="text-xs text-neutral-400">
              {saving ? "Saving…" : `${slideCount} slide${slideCount === 1 ? "" : "s"}`}
            </span>
            <select
              value={theme}
              onChange={(e) => edit({ theme: e.target.value })}
              className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-sm capitalize"
            >
              {THEMES.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={exportPdf}
              disabled={exporting}
              className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              PDF
            </button>
            <button
              onClick={present}
              className="flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700"
            >
              <Play size={14} /> Present
            </button>
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Decks</span>
            <button onClick={newDeck} className="rounded p-1 text-neutral-500 hover:bg-neutral-100" title="New deck">
              <Plus size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {decks.map((d) => (
              <div
                key={d.id}
                onClick={() => selectDeck(d)}
                className={`group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                  d.id === selectedId ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"
                }`}
              >
                <span className="flex-1 truncate">{d.title || "Untitled"}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDeck(d.id);
                  }}
                  className="hidden text-neutral-400 hover:text-red-500 group-hover:block"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {decks.length === 0 && (
              <button onClick={newDeck} className="m-3 rounded-md border border-dashed border-neutral-300 px-3 py-6 text-sm text-neutral-500 hover:bg-neutral-50">
                Create your first deck
              </button>
            )}
          </div>

          {/* media */}
          <div className="border-t border-neutral-200">
            <label className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400 hover:text-neutral-600">
              <ImagePlus size={14} /> Images
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
              />
            </label>
            <div className="max-h-40 overflow-y-auto px-2 pb-2">
              {assets.map((a) => (
                <button
                  key={a.id}
                  onClick={() => insertImage(a)}
                  title={`Insert ${a.name}`}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100"
                >
                  <img src={`/api/uploads/${a.key}`} alt="" className="h-6 w-6 rounded object-cover" />
                  <span className="truncate">{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* editor */}
        {selected ? (
          <main className="flex min-w-0 flex-1">
            <section className="flex w-2/5 min-w-0 flex-col border-r border-neutral-200">
              <input
                value={title}
                onChange={(e) => edit({ title: e.target.value })}
                placeholder="Deck title"
                className="border-b border-neutral-200 px-4 py-2.5 text-sm font-medium outline-none"
              />
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => edit({ content: e.target.value })}
                spellCheck={false}
                placeholder="Write your slides in Markdown. Separate slides with a line containing only ---"
                className="flex-1 resize-none px-4 py-3 font-mono text-[13px] leading-relaxed outline-none"
              />
            </section>
            <section className="flex min-w-0 flex-1 flex-col bg-neutral-100">
              <iframe
                key={viewKey}
                ref={previewRef}
                src={`/api/decks/${selected.id}/view?h=${pos.current.h}&v=${pos.current.v}&t=${viewKey}`}
                title="Preview"
                allowFullScreen
                className="h-full w-full border-0 bg-white"
              />
            </section>
          </main>
        ) : (
          <main className="grid flex-1 place-items-center text-neutral-400">
            <div className="text-center">
              <Presentation size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">Create a deck to start.</p>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
