# Open Slides — agent guide

This app turns **designed HTML slides into reveal.js decks**. You author each
slide as a small block of HTML that fills a 1280×720 canvas and is styled with
the active brand's CSS variables, the user drops in logos/images, presents
fullscreen in the browser, and exports to PDF on the managed Clawnify render
service. You never touch a browser or a PDF toolchain — you write HTML and call
this app's API. **Markdown is not supported.**

Base URL: this app's own origin. All endpoints are under `/api`.

## Deck format

A deck is one document. Slides are separated by a line containing only `---`.
Every slide is HTML laid out on a full 1280×720 canvas. Style with the brand CSS
variables (never hardcode brand colors/fonts) so the deck stays on-brand:
`--brand-bg`, `--brand-text`, `--brand-heading`, `--brand-accent`,
`--brand-muted`, `--brand-hero-size`, `--brand-body-size`, `--brand-radius`,
`--r-heading-font` (display font), `--r-main-font` (body font).

```html
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 9%;box-sizing:border-box">
  <div class="kicker" style="font-size:24px">Your kicker</div>
  <h1 style="font:700 var(--brand-hero-size)/1.02 var(--r-heading-font);margin:14px 0 0;color:var(--brand-heading)">Title slide</h1>
  <p style="font:400 var(--brand-body-size)/1.4 var(--r-main-font);color:var(--brand-muted);max-width:72%;margin-top:18px">A supporting subtitle.</p>
</div>

---

<!-- .slide: data-background-color="#0a0a0a" -->
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 9%;box-sizing:border-box">
  <h2 style="font:700 60px/1.05 var(--r-heading-font);margin:0;color:var(--brand-heading)">Second slide</h2>
  <div class="chart" style="flex:1;min-height:0;max-height:400px;margin-top:18px" data-chart='{"type":"bar","labels":["Q1","Q2","Q3"],"data":[12,19,27]}'></div>
  <aside class="notes">Only shows in the presenter view.</aside>
</div>
```

- **Per-slide background:** a `<!-- .slide: ATTRS -->` line as the slide's FIRST
  line sets reveal slide attributes — `data-background-color`,
  `data-background-gradient`, or `data-background-image="assets/<key>"`.
- **Charts:** a `<div class="chart" data-chart='{"type":"bar|line|donut","labels":[…],"data":[…]}'></div>`
  renders as on-brand SVG automatically (give it a height). Don't style it yourself.
- **Animations:** `class="fragment fade-up"` makes an element animate in — these
  play only while presenting, never in the editor or the PDF. Effects: fade-up,
  fade-down, fade-left, fade-right, zoom-in, grow.
- **Speaker notes:** `<aside class="notes">…</aside>` inside a slide.
- **Code:** `<pre><code class="language-ts">…</code></pre>` is syntax-highlighted.

## Embedding media

Upload an image or video with `POST /api/assets` (multipart `file`) → `{ key }`,
then reference it by path `assets/<key>`: `<img src="assets/<key>">` or
`<video controls src="assets/<key>"></video>`. On PDF export the app inlines
referenced images automatically — you don't attach them.

There is no media library to list: an asset exists only while a slide (or a
brand logo) references it. Remove the reference and the file is garbage-collected
from storage, so don't upload media you aren't going to place on a slide.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/decks` | List decks |
| GET  | `/api/decks/{id}` | Get one (includes `content`) |
| POST | `/api/decks` | Create `{ title, content?, theme?, brand_id? }` |
| PUT  | `/api/decks/{id}` | Update any of `title/content/theme/brand_id` |
| DELETE | `/api/decks/{id}` | Delete |
| GET  | `/api/decks/{id}/view` | Interactive reveal.js deck (HTML) |
| GET  | `/api/decks/{id}/pdf` | Export to PDF (one slide per page) |
| GET  | `/api/brands` | List brands (id, name, tokens) |
| POST | `/api/assets` | Upload an image/video (multipart `file`) → `{ key }` |

`theme` is a reveal.js theme name (the base under the brand's token overrides):
`white`, `black`, `league`, `beige`, `sky`, `night`, `serif`, `simple`,
`solarized`, `moon`, `dracula`, `blood`.

## Authoring flow

1. Read the brief. Pick the brand (`GET /api/brands`) and pass its `brand_id`.
2. If the deck needs images/video, `POST /api/assets` each file and place it
   with `assets/<key>`. Upload only what you'll actually reference.
3. Write the deck as HTML slides — one idea per slide, slides split by `---`,
   styled with the brand variables — and `POST /api/decks` (or `PUT` to revise).
4. The user presents it in-app (fullscreen) or you can hand them
   `GET /api/decks/{id}/pdf` for a shareable PDF.

## How export works (so you can reason about failures)

`GET /api/decks/{id}/pdf` builds a print-mode reveal.js page (reveal's own
`?print-pdf` layout, one `.pdf-page` per slide) and sends it to Clawnify's
managed PDF service, which returns one PDF page per slide. The app does no
rendering itself. A `503` means PDF export isn't configured (no managed token —
only happens in local dev). A `502` means the render service rejected the deck;
the `detail` field explains why.
