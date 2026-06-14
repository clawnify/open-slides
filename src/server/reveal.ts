// Builds a self-contained reveal.js HTML document from a deck. A deck is one
// document split into slides on a line of `---`. Each slide is either:
//   • Markdown (default) — rendered via reveal's markdown plugin, or
//   • a designed HTML slide — when the chunk starts with `<!-- html -->`. An
//     optional `<!-- .slide: ATTRS -->` line sets reveal slide attributes
//     (e.g. data-background-image) on the <section>.
// Markdown and HTML slides interleave freely.
//
// Two modes:
//   "view"  — interactive deck (editor preview + in-app fullscreen present).
//   "print" — print-pdf layout (one slide per page) for PDF export.
//
// `content` must already have its media references resolved by the caller
// (view: /api/uploads/<key>; print: inlined data: URIs). Brand markup is
// injected via brandHeadHtml (<head>) and brandLogoHtml (per-page overlay).

const REVEAL = "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0";

export const THEMES = [
  "white", "black", "league", "beige", "sky", "night",
  "serif", "simple", "solarized", "moon", "dracula", "blood",
] as const;

export function safeTheme(theme: string | undefined): string {
  return (THEMES as readonly string[]).includes(theme ?? "") ? (theme as string) : "white";
}

/** Split a deck document into its slide chunks (on lines of `---`). */
export function splitSlides(content: string): string[] {
  const normalized = ("\n" + content + "\n").replace(/\r\n/g, "\n");
  return normalized
    .split(/\n[ \t]*---[ \t]*\n/)
    .map((raw) => raw.replace(/^\n+|\n+$/g, ""))
    .filter((c) => c.trim());
}

function buildSections(content: string, only?: number): string {
  let chunks = splitSlides(content);
  if (only != null && only >= 0 && only < chunks.length) chunks = [chunks[only]];
  const sections: string[] = [];

  for (const chunk of chunks) {
    if (/^<!--\s*html\s*-->/i.test(chunk.trim())) {
      let rest = chunk.trim().replace(/^<!--\s*html\s*-->\s*\n?/i, "");
      // Optional reveal slide attributes on the first remaining line.
      let attrs = "";
      const attrMatch = rest.match(/^<!--\s*\.slide:\s*([\s\S]*?)-->\s*\n?/i);
      if (attrMatch) {
        attrs = " " + attrMatch[1].trim();
        rest = rest.slice(attrMatch[0].length);
      }
      sections.push(`<section class="design"${attrs}>\n${rest}\n</section>`);
    } else {
      const md = chunk.replace(/<\/textarea>/gi, "<\\/textarea>");
      sections.push(
        `<section class="md" data-markdown data-separator-notes="^Note:">\n<textarea data-template>\n${md}\n</textarea>\n</section>`,
      );
    }
  }

  return sections.join("\n") || `<section><h2>Empty deck</h2></section>`;
}

interface DocOpts {
  mode: "view" | "print";
  content: string;
  theme: string;
  brandHeadHtml: string;
  brandLogoHtml: string;
  h?: number;
  v?: number;
  only?: number; // render just this slide (for Pages thumbnails)
  thumb?: boolean; // chrome-less, non-interactive (thumbnail)
  nav?: { arrows: boolean; progress: boolean; slideNumber: boolean };
}

export function revealDoc(opts: DocOpts): string {
  const theme = safeTheme(opts.theme);
  const sections = buildSections(opts.content, opts.only);

  const printShim =
    opts.mode === "print"
      ? `<script>try{history.pushState({},'','?print-pdf');}catch(e){}</script>`
      : "";

  // Fixed 16:9 design canvas. center:false so designed (absolute / left-aligned)
  // slides aren't vertically re-centered by reveal — markdown slides get their
  // own centering via the `.md` CSS below.
  const SIZING = "width: 1280, height: 720, margin: 0, center: false,";

  const harness =
    opts.mode === "print"
      ? `Reveal.initialize({
           plugins: [RevealMarkdown, RevealHighlight, RevealNotes],
           ${SIZING}
           pdfMaxPagesPerSlide: 1,
           pdfSeparateFragments: false,
           controls: false,
           progress: false,
         });`
      : opts.thumb
      ? `Reveal.initialize({
           plugins: [RevealMarkdown, RevealHighlight],
           ${SIZING}
           controls: false, progress: false, embedded: true, transition: 'none',
         });`
      : `var params = new URLSearchParams(location.search);
         Reveal.initialize({
           plugins: [RevealMarkdown, RevealHighlight, RevealNotes],
           ${SIZING}
           embedded: false,
           controls: ${opts.nav ? opts.nav.arrows : true},
           progress: ${opts.nav ? opts.nav.progress : true},
           hash: false,
           slideNumber: ${opts.nav && !opts.nav.slideNumber ? "false" : "'c/t'"},
           transition: 'slide',
         }).then(function () {
           var h = parseInt(params.get('h') || '0', 10) || 0;
           var v = parseInt(params.get('v') || '0', 10) || 0;
           if (h || v) Reveal.slide(h, v);
           Reveal.on('slidechanged', report);
           addEventListener('message', function (e) {
             var m = e.data || {};
             if (m && m.target === 'slides-view' && m.type === 'goto') {
               try { Reveal.slide(m.h || 0, m.v || 0); } catch (_) {}
             }
           });
           // Tag editable elements of the active slide with a stable index so
           // the editor can map a click back to the source element. A plain div
           // is included so text-only divs (a kicker, a big stat) are editable;
           // container divs are excluded at click time via isLeaf().
           var SEL = 'div,h1,h2,h3,h4,h5,h6,p,li,blockquote,span,strong,em,code,td,th,figcaption,img';
           var BLOCK = 'div,h1,h2,h3,h4,h5,h6,p,ul,ol,li,img,table,blockquote,section';
           function isLeaf(el) { return !el.querySelector(BLOCK) && (el.textContent || '').trim().length > 0; }
           var EFFECTS = ['fade-up','fade-down','fade-left','fade-right','zoom-in','grow','shrink'];
           function tagSids() {
             var sec = document.querySelector('.reveal .slides section.present');
             if (sec) sec.querySelectorAll(SEL).forEach(function (el, i) { el.setAttribute('data-sid', String(i)); });
           }
           Reveal.on('slidechanged', tagSids); tagSids();
           function animOf(el) {
             var cls = el.className || '';
             for (var i = 0; i < EFFECTS.length; i++) if (cls.indexOf(EFFECTS[i]) >= 0) return EFFECTS[i];
             return /\bfragment\b/.test(cls) ? 'fade' : 'none';
           }

           // Click-to-edit: text element → select + inline edit; image → replace;
           // empty background → change the slide's background.
           var TEXT = {H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,P:1,LI:1,BLOCKQUOTE:1,SPAN:1,STRONG:1,EM:1,CODE:1,TD:1,TH:1,FIGCAPTION:1};
           document.addEventListener('click', function (e) {
             if (e.target && e.target.isContentEditable) return; // already editing
             var node = e.target, img = null, textEl = null;
             while (node && node !== document.body) {
               var tag = (node.tagName || '').toUpperCase();
               if (tag === 'IMG') { img = node; break; }
               if (TEXT[tag]) { textEl = node; break; }
               if (tag === 'DIV' && isLeaf(node)) { textEl = node; break; }
               if (tag === 'A' || tag === 'BUTTON') return;
               node = node.parentElement;
             }
             if (img) {
               parent.postMessage({ source: 'slides-preview', type: 'img-click', sid: parseInt(img.getAttribute('data-sid') || '-1', 10), src: img.getAttribute('src') || '' }, '*');
             } else if (textEl) {
               var sid = parseInt(textEl.getAttribute('data-sid') || '-1', 10);
               parent.postMessage({ source: 'slides-preview', type: 'el-select', sid: sid, tag: textEl.tagName, anim: animOf(textEl), text: textEl.textContent }, '*');
               startEdit(textEl, sid);
             } else {
               parent.postMessage({ source: 'slides-preview', type: 'bg-click' }, '*');
             }
           });
           function startEdit(el, sid) {
             var old = el.textContent;
             el.setAttribute('contenteditable', 'true');
             el.focus();
             var r = document.createRange(); r.selectNodeContents(el);
             var s = getSelection(); s.removeAllRanges(); s.addRange(r);
             function finish() {
               el.removeAttribute('contenteditable');
               el.removeEventListener('blur', finish);
               el.removeEventListener('keydown', onKey);
               var now = el.textContent;
               if (now !== old) parent.postMessage({ source: 'slides-preview', type: 'el-edit', sid: sid, oldText: old, newText: now }, '*');
             }
             function onKey(ev) {
               if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
               else if (ev.key === 'Escape') { el.textContent = old; el.blur(); }
             }
             el.addEventListener('blur', finish);
             el.addEventListener('keydown', onKey);
           }
           parent.postMessage({ source: 'slides-preview', type: 'ready', slides: Reveal.getTotalSlides() }, '*');
           report();
         });
         function report() {
           var i = Reveal.getIndices();
           parent.postMessage({ source: 'slides-preview', type: 'slidechanged', h: i.h, v: i.v }, '*');
         }`;

  // The base theme provides layout/sizing rules; the brand head overrides the
  // reveal --r-* color/font variables on top of it.
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${REVEAL}/dist/reveal.css" />
<link rel="stylesheet" href="${REVEAL}/dist/theme/${theme}.css" id="theme" />
<link rel="stylesheet" href="${REVEAL}/plugin/highlight/monokai.css" />
<style>
  html,body{margin:0;padding:0;height:100%}
  /* Designed slides control their own layout and are left-aligned; markdown
     slides keep the classic vertically-centered look. The centering is scoped
     to the active (.present) section so it beats reveal's display:block without
     overriding the display:none on inactive slides (which would stack them). */
  .reveal .slides { text-align: left; }
  .reveal .slides > section { height: 100%; box-sizing: border-box; }
  .reveal .slides > section.md.present {
    display: flex !important; flex-direction: column;
    justify-content: center; align-items: center; text-align: center; padding: 0 8%;
  }
  .reveal .slides > section.md > * { max-width: 100%; }
</style>
${opts.brandHeadHtml}
${printShim}
</head><body>
${opts.brandLogoHtml}
<div class="reveal"><div class="slides">
${sections}
</div></div>
<script src="${REVEAL}/dist/reveal.js"></script>
<script src="${REVEAL}/plugin/markdown/markdown.js"></script>
<script src="${REVEAL}/plugin/highlight/highlight.js"></script>
<script src="${REVEAL}/plugin/notes/notes.js"></script>
<script>${harness}</script>
</body></html>`;
}
