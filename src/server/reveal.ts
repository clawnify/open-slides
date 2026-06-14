// Builds a self-contained reveal.js HTML document from a deck's Markdown.
// Two modes:
//   "view"  — interactive deck, embedded in the editor iframe and fullscreened
//             for in-app presenting. Talks to the parent via postMessage so the
//             editor can track/restore the current slide across edit-reloads.
//   "print" — print-pdf layout (one slide per page) for PDF export. The headless
//             renderer loads this HTML and runs page.pdf(); the pushState shim
//             puts reveal into print-pdf mode without a query string on the URL.

const REVEAL = "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0";

// reveal.js bundled themes we expose in the editor's theme picker.
export const THEMES = [
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
] as const;

export type Theme = (typeof THEMES)[number];

export function safeTheme(theme: string | undefined): Theme {
  return (THEMES as readonly string[]).includes(theme ?? "") ? (theme as Theme) : "white";
}

interface ViewOpts {
  mode: "view";
  content: string;
  theme: string;
  h?: number;
  v?: number;
}

interface PrintOpts {
  mode: "print";
  content: string;
  theme: string;
}

export function revealDoc(opts: ViewOpts | PrintOpts): string {
  const theme = safeTheme(opts.theme);

  // In "view" mode, media is referenced as a relative `assets/<key>` path; the
  // iframe is same-origin with the app, so rewrite to the served R2 route. In
  // "print" mode the caller has already inlined assets as data: URIs (the
  // headless renderer can't reach the app's authenticated /api/uploads route).
  const body =
    opts.mode === "view"
      ? opts.content.replace(/(["'(])assets\//g, "$1/api/uploads/")
      : opts.content;

  // A literal `</textarea>` in the Markdown would close the template early.
  const md = body.replace(/<\/textarea>/gi, "<\\/textarea>");

  const printShim =
    opts.mode === "print"
      ? `<script>try{history.pushState({},'','?print-pdf');}catch(e){}</script>`
      : "";

  const harness =
    opts.mode === "print"
      ? `Reveal.initialize({
           plugins: [RevealMarkdown, RevealHighlight, RevealNotes],
           pdfMaxPagesPerSlide: 1,
           pdfSeparateFragments: false,
           controls: false,
           progress: false,
         });`
      : `var params = new URLSearchParams(location.search);
         Reveal.initialize({
           plugins: [RevealMarkdown, RevealHighlight, RevealNotes],
           embedded: false,
           controls: true,
           progress: true,
           hash: false,
           slideNumber: 'c/t',
           transition: 'slide',
         }).then(function () {
           var h = parseInt(params.get('h') || '0', 10) || 0;
           var v = parseInt(params.get('v') || '0', 10) || 0;
           if (h || v) Reveal.slide(h, v);
           Reveal.on('slidechanged', report);
           parent.postMessage({ source: 'slides-preview', type: 'ready', slides: Reveal.getTotalSlides() }, '*');
           report();
         });
         function report() {
           var i = Reveal.getIndices();
           parent.postMessage({ source: 'slides-preview', type: 'slidechanged', h: i.h, v: i.v }, '*');
         }`;

  // NB: the Markdown inside <textarea> must not be indented — leading whitespace
  // would break headings, list items and code fences.
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${REVEAL}/dist/reveal.css" />
<link rel="stylesheet" href="${REVEAL}/dist/theme/${theme}.css" id="theme" />
<link rel="stylesheet" href="${REVEAL}/plugin/highlight/monokai.css" />
<style>html,body{margin:0;padding:0;height:100%}</style>
${printShim}
</head><body>
<div class="reveal"><div class="slides">
<section data-markdown data-separator="^\\r?\\n---\\r?\\n$" data-separator-vertical="^\\r?\\n--\\r?\\n$" data-separator-notes="^Note:">
<textarea data-template>
${md}
</textarea>
</section>
</div></div>
<script src="${REVEAL}/dist/reveal.js"></script>
<script src="${REVEAL}/plugin/markdown/markdown.js"></script>
<script src="${REVEAL}/plugin/highlight/highlight.js"></script>
<script src="${REVEAL}/plugin/notes/notes.js"></script>
<script>${harness}</script>
</body></html>`;
}
