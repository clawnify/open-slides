// Branded slide templates. Each `body` is a ready-to-insert deck chunk: the
// `<!-- html -->` marker tells the renderer it's a designed HTML slide, and the
// markup uses the brand CSS variables (var(--brand-*), var(--r-*)) so every
// template is on-brand automatically. The client inserts these into the deck.

export interface SlideTemplate {
  id: string;
  name: string;
  body: string;
}

const wrap = (inner: string) =>
  `<!-- html -->
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;padding:0 9%;box-sizing:border-box">
${inner}
</div>`;

export const TEMPLATES: SlideTemplate[] = [
  {
    id: "title",
    name: "Title",
    body: wrap(`  <div class="kicker" style="font-size:24px">Your kicker</div>
  <h1 style="font:700 var(--brand-hero-size)/1.02 var(--r-heading-font);margin:14px 0 0;color:var(--brand-heading)">Big bold title</h1>
  <p style="font:400 var(--brand-body-size)/1.4 var(--r-main-font);color:var(--brand-muted);max-width:72%;margin-top:18px">A supporting subtitle that sets the scene in one clear line.</p>`),
  },
  {
    id: "section",
    name: "Section divider",
    body: wrap(`  <div class="kicker" style="font-size:22px">Part 01</div>
  <h2 style="font:700 76px/1.05 var(--r-heading-font);margin:10px 0 0;color:var(--brand-heading)">Section title</h2>`),
  },
  {
    id: "stat",
    name: "Big stat",
    body: wrap(`  <div style="font:700 200px/1 var(--r-heading-font);color:var(--brand-accent)">98%</div>
  <p style="font:400 34px/1.35 var(--r-main-font);color:var(--brand-text);max-width:70%;margin-top:6px">What the number means, in one sentence.</p>`),
  },
  {
    id: "quote",
    name: "Quote",
    body: wrap(`  <blockquote style="border:0;box-shadow:none;background:none;margin:0;padding:0">
    <p style="font:500 52px/1.25 var(--r-heading-font);color:var(--brand-heading)">“A short, punchy quote that lands the point.”</p>
  </blockquote>
  <div style="font:600 26px/1 var(--r-main-font);color:var(--brand-muted);margin-top:28px">— Name, Title</div>`),
  },
  {
    id: "bullets",
    name: "Title + bullets",
    body: wrap(`  <h2 style="font:700 60px/1.05 var(--r-heading-font);margin:0;color:var(--brand-heading)">Slide title</h2>
  <ul style="font:400 34px/1.7 var(--r-main-font);color:var(--brand-text);margin-top:28px;padding-left:1.1em;max-width:80%">
    <li>First point worth making</li>
    <li>Second point worth making</li>
    <li>Third point worth making</li>
  </ul>`),
  },
  {
    id: "two-col",
    name: "Two columns",
    body: `<!-- html -->
<div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;gap:6%;align-items:center;padding:0 9%;box-sizing:border-box">
  <div>
    <h2 style="font:700 56px/1.06 var(--r-heading-font);margin:0;color:var(--brand-heading)">Left column</h2>
    <p style="font:400 30px/1.5 var(--r-main-font);color:var(--brand-text);margin-top:18px">A paragraph of context that fills the left side.</p>
  </div>
  <div>
    <h2 style="font:700 56px/1.06 var(--r-heading-font);margin:0;color:var(--brand-heading)">Right column</h2>
    <p style="font:400 30px/1.5 var(--r-main-font);color:var(--brand-text);margin-top:18px">A matching paragraph on the right side.</p>
  </div>
</div>`,
  },
  {
    id: "image-left",
    name: "Image + text",
    body: `<!-- html -->
<div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;align-items:center;box-sizing:border-box">
  <img src="assets/your-image.png" alt="" style="width:100%;height:100%;object-fit:cover" />
  <div style="padding:0 8%">
    <div class="kicker" style="font-size:20px">Feature</div>
    <h2 style="font:700 56px/1.06 var(--r-heading-font);margin:8px 0 0;color:var(--brand-heading)">Show, then tell</h2>
    <p style="font:400 30px/1.5 var(--r-main-font);color:var(--brand-text);margin-top:18px">Describe what's on the left. Replace the image with one from your library.</p>
  </div>
</div>`,
  },
  {
    id: "full-bleed",
    name: "Full-bleed image",
    body: `<!-- html -->
<!-- .slide: data-background-image="assets/your-image.png" data-background-size="cover" -->
<div style="position:absolute;left:9%;bottom:9%;max-width:70%">
  <h2 style="font:700 64px/1.05 var(--r-heading-font);margin:0;color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.5)">Caption over a full-bleed photo</h2>
</div>`,
  },
];
