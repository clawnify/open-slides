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

// Deterministic, dependency-free SVG charts. A slide includes a chart with:
//   <div class="chart" style="height:..." data-chart='{"type":"bar","labels":[...],"data":[...]}'></div>
// This script computes & draws an on-brand SVG (bar / line / donut) into it,
// picking up the brand accent/muted colors. SVG renders identically in the
// canvas, while presenting, and in the exported PDF.
const CHART_FNS = `
  function _bv(n,f){var v=getComputedStyle(document.documentElement).getPropertyValue(n).trim();return v||f;}
  function _arc(cx,cy,r,ir,a0,a1,fill){
    function p(rad,a){return [cx+rad*Math.cos(a),cy+rad*Math.sin(a)];}
    var lg=(a1-a0)>Math.PI?1:0,o0=p(r,a0),o1=p(r,a1),i1=p(ir,a1),i0=p(ir,a0);
    return '<path d="M'+o0[0]+' '+o0[1]+' A'+r+' '+r+' 0 '+lg+' 1 '+o1[0]+' '+o1[1]+' L'+i1[0]+' '+i1[1]+' A'+ir+' '+ir+' 0 '+lg+' 0 '+i0[0]+' '+i0[1]+' Z" fill="'+fill+'"/>';
  }
  function renderCharts(root){
    var nodes=(root||document).querySelectorAll('[data-chart]:not([data-charted])');
    for(var k=0;k<nodes.length;k++){(function(el){
      el.setAttribute('data-charted','1');
      var cfg; try{cfg=JSON.parse(el.getAttribute('data-chart'));}catch(e){return;}
      var w=el.clientWidth||640,h=el.clientHeight||340;
      var accent=_bv('--brand-accent','#6D4CFF'),muted=_bv('--brand-muted','#9a9a9a'),text=_bv('--brand-text','#333');
      var type=cfg.type||'bar',labels=cfg.labels||[],data=(cfg.data||[]).map(Number);
      var s='<svg width="100%" height="100%" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">';
      var pL=44,pB=30,pT=12,pR=12,cw=w-pL-pR,ch=h-pT-pB,max=Math.max.apply(null,data.concat([1]));
      if(type==='bar'){
        var n=data.length||1,step=cw/n,bw=step*0.62;
        for(var i=0;i<data.length;i++){var bh=ch*(data[i]/max),x=pL+i*step+(step-bw)/2,y=pT+ch-bh;
          s+='<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(bh,1)+'" rx="3" fill="'+accent+'"/>';
          s+='<text x="'+(x+bw/2)+'" y="'+(h-10)+'" fill="'+muted+'" font-size="13" text-anchor="middle">'+(labels[i]||'')+'</text>';}
      } else if(type==='line'){
        var n=data.length,pts=[];for(var i=0;i<n;i++){pts.push([pL+(n<=1?cw/2:i*(cw/(n-1))),pT+ch-ch*(data[i]/max)]);}
        var d='';for(var i=0;i<pts.length;i++){d+=(i?'L':'M')+pts[i][0]+' '+pts[i][1]+' ';}
        s+='<path d="'+d+'" fill="none" stroke="'+accent+'" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
        for(var i=0;i<pts.length;i++){s+='<circle cx="'+pts[i][0]+'" cy="'+pts[i][1]+'" r="4" fill="'+accent+'"/>';
          s+='<text x="'+pts[i][0]+'" y="'+(h-10)+'" fill="'+muted+'" font-size="13" text-anchor="middle">'+(labels[i]||'')+'</text>';}
      } else if(type==='donut'||type==='pie'){
        var total=0;for(var i=0;i<data.length;i++)total+=data[i];total=total||1;
        var cx=w/2,cy=(h-14)/2+pT,r=Math.min(cw,ch)/2,ir=type==='donut'?r*0.62:0,a0=-Math.PI/2;
        var pal=[accent,muted,text,'#cfcfcf','#e6e6e6'];
        for(var i=0;i<data.length;i++){var a1=a0+2*Math.PI*(data[i]/total);s+=_arc(cx,cy,r,ir,a0,a1,pal[i%pal.length]);a0=a1;}
      }
      s+='</svg>';el.innerHTML=s;
    })(nodes[k]);}
  }`;

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
           plugins: [RevealMarkdown, RevealHighlight],
           ${SIZING}
           showNotes: false,
           pdfMaxPagesPerSlide: 1,
           pdfSeparateFragments: false,
           controls: false,
           progress: false,
           slideNumber: ${opts.nav && opts.nav.slideNumber ? "'c/t'" : "false"},
         }).then(function () { renderCharts(document); });`
      : opts.thumb
      ? `Reveal.initialize({
           plugins: [RevealMarkdown, RevealHighlight],
           ${SIZING}
           controls: false, progress: false, embedded: true, transition: 'none',
         }).then(function () { renderCharts(document); });`
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
           renderCharts(Reveal.getCurrentSlide());
           Reveal.on('slidechanged', function (e) { renderCharts(e.currentSlide); });
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
  .reveal .slides { text-align: left; }
  /* Designed slides are a fixed 1280x720 box, so their absolute (inset:0) layout
     fills correctly in BOTH the scaled screen view AND reveal's print-pdf pages.
     (Relying on the section's parent height collapses the content in print.) */
  .reveal .slides > section.design { width: 1280px; height: 720px; box-sizing: border-box; }
  /* Markdown slides: vertically centered, classic look. Screen-only + applied to
     .past/.future so the outgoing slide doesn't snap to top-left and flash during
     a transition. In print, reveal's native pagination centers them. */
  @media screen {
    .reveal .slides > section.md.present,
    .reveal .slides > section.md.past,
    .reveal .slides > section.md.future {
      display: flex !important; flex-direction: column; height: 100%;
      justify-content: center; align-items: center; text-align: center; padding: 0 8%;
    }
    .reveal .slides > section.md > * { max-width: 100%; }
  }
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
${opts.mode === "view" && !opts.thumb ? `<script src="${REVEAL}/plugin/notes/notes.js"></script>` : ""}
<script>${CHART_FNS}</script>
<script>${harness}</script>
</body></html>`;
}
