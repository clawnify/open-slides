// Brand layer. The org keeps ONE design system as an agent-authored DESIGN.md
// (prose guidance for the agent) carrying a machine-readable tokens block that
// the app turns into reveal.js theme variables, web-font links and a logo
// overlay. Every deck inherits it — so slides are on-brand by construction.
//
// The tokens block is a fenced ```clawnify-brand JSON object inside the
// DESIGN.md. Prose around it guides the agent; the JSON drives rendering.

export interface BrandTokens {
  colors: { bg: string; text: string; heading: string; accent: string; muted: string };
  fonts: { heading: string; body: string; mono: string; google: string[] };
  sizes: { heading: number; subheading: number; body: number }; // px (12–100), 16:9 canvas
  radius: string;
  logo: string; // "assets/<key>" or a URL, or "" for none
  logoPosition: LogoPosition; // which corner the logo overlay sits in
  textAlign: TextAlign; // horizontal alignment of slide content, deck-wide
}

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const LOGO_POSITIONS: LogoPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
export type TextAlign = "left" | "center";
const TEXT_ALIGNS: TextAlign[] = ["left", "center"];

const DEFAULTS: BrandTokens = {
  colors: { bg: "#FFFFFF", text: "#1A1814", heading: "#111111", accent: "#6D4CFF", muted: "#6F6A63" },
  fonts: {
    heading: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    google: [],
  },
  sizes: { heading: 72, subheading: 44, body: 24 },
  radius: "14px",
  logo: "",
  logoPosition: "bottom-right",
  textAlign: "left",
};

export const DEFAULT_BRAND_MD = `# Brand design system

## Overview

A clean, confident slide system — a light canvas, near-black ink, and a single
accent used sparingly. Every slide carries one idea: a headline, a stat, a quote,
a chart, or one image, with generous whitespace and a strict type hierarchy. It
reads as engineered, not decorated.

The type voice splits into two roles: a **display** face for headlines (big, with
tight tracking) and a **body** face for everything else. The boundary is strict —
never set body copy in the display face, never set a headline in the body face.

Slides are full-bleed and left-aligned with content vertically centered. Color
does the emphasis work — the accent appears on kickers, key numbers, links and
charts, never on large fills.

**Key characteristics**
- Light canvas (the bg token), near-black ink, one accent reserved for emphasis.
- Display font for headlines at the hero size; body font for support at the body size.
- One focal point per slide. Prefer a designed slide over a wall of bullets.
- A small uppercase accent kicker opens most content slides.
- Generous whitespace; ~9% side padding on the 1280×720 canvas.

## Colors

### Surface
- **Canvas** (the bg token) — the floor every slide sits on.

### Text
- **Heading** — all display headlines and titles.
- **Body** — default running text and bullets.
- **Muted** — secondary copy: supporting lines under a headline, captions, axis labels, footnotes.

### Accent
- **Accent** — the single emphasis color: kickers, a key stat, links, chart series, the active nav/progress. Used sparingly; never as a large fill or on long passages.

## Typography

### Font family
A display face for headlines and a body face for everything else. The fallback
stack walks the system UI fonts. Cal-style modern-SaaS pairing by default
(Space Grotesk display + Inter body), swappable per brand.

### Hierarchy
| Role | Size | Weight | Use |
|---|---|---|---|
| Heading | heading token | 700 | The biggest headline on a title or section slide (h1) |
| Subheading | subheading token | 700 | A content-slide headline (h2) |
| Kicker | ~18-24px | 600, uppercase, tracked | The small accent eyebrow above a headline |
| Paragraph | body token | 400 | Supporting lines, bullets, captions |
| Stat | ~1.8x heading | 700, accent | A single big number |

Each of the three sizes (heading, subheading, paragraph) is configurable from 12
to 100px. Plain h1/h2/p inherit them, so you rarely set a size by hand.

### Principles
- One headline per slide. Tight, slightly negative tracking on display sizes.
- Keep the display weight consistent (700); let size and color carry hierarchy.
- Body stays regular weight. Never blur the display/body boundary.

## Layout

### Canvas
Every slide is a fixed 1280×720 (16:9) canvas. Designed slides position content
absolutely inside it; reveal scales the whole canvas to any screen.

### Composition
- Left-aligned, vertically centered, ~9% side padding.
- Whitespace is generous — let one idea breathe; never pack a slide.

### Spacing
Base unit 4px. Comfortable gaps: 8 / 16 / 24 / 48px. Kicker to headline ~14px;
headline to supporting line ~18px.

## Shapes
A soft, modern radius (the radius token) on cards, images and chart frames.
Nothing heavier. Avatars and icon chips are full circles.

## Elevation & depth
Flat and clean. No heavy shadows, no glassmorphism. Emphasis comes from color and
scale. Full-bleed images and color-block backgrounds do the heavy lifting.

## Slide types
- **Title** — kicker + hero headline + one supporting line. The opener.
- **Section divider** — kicker (e.g. "Part 01") + a large section title.
- **Big stat** — one number in the accent at very large size + a one-line gloss.
- **Quote** — a short statement in the display face + attribution in muted body.
- **Agenda / bullets** — a title + 3-5 short bullets. Use sparingly.
- **Chart** — a title + one chart (see Data & charts). One chart per slide.
- **Image + text** — a full-height image beside a kicker + headline + line.
- **Full-bleed image** — a photo background with a short caption bottom-left.

## Example slides
Three slides that show the system in practice. Each fills the 1280×720 canvas,
styles with the brand variables, and omits alignment so it inherits the brand's
default (override per slide only when a layout needs it).

### Title
\`\`\`html
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 9%;box-sizing:border-box">
  <span class="kicker">Product launch</span>
  <h1 style="color:var(--brand-heading);margin:14px 0 0">The future of focus</h1>
  <p style="color:var(--brand-muted);max-width:60%;margin-top:18px">One workspace that thinks with you.</p>
</div>
\`\`\`

### Big stat
\`\`\`html
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 9%;box-sizing:border-box">
  <span class="kicker">Impact</span>
  <div style="font:700 calc(var(--brand-heading-size) * 1.8)/1 var(--r-heading-font);color:var(--brand-accent);margin-top:6px">3.2×</div>
  <p style="color:var(--brand-muted);max-width:55%;margin-top:12px">faster review cycles after the first month.</p>
</div>
\`\`\`

### Chart
\`\`\`html
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 9%;box-sizing:border-box">
  <span class="kicker">Growth</span>
  <h2 style="color:var(--brand-heading);margin:8px 0 0">Revenue more than doubled</h2>
  <div class="chart" style="flex:1;min-height:0;max-height:380px;margin-top:24px" data-chart='{"type":"bar","labels":["Q1","Q2","Q3","Q4"],"data":[12,19,22,31]}'></div>
</div>
\`\`\`

## Data & charts
Show data with a chart element, never a screenshot of one. Charts render as
on-brand SVG (the accent for the series, muted for labels) — bar, line or donut:

\`\`\`html
<div class="chart" style="height:380px"
     data-chart='{"type":"bar","labels":["Q1","Q2","Q3","Q4"],"data":[12,19,15,27]}'></div>
\`\`\`

One chart per slide, paired with a short headline that states the takeaway. Don't
style the chart yourself — it picks up the brand colors automatically.

## Do's and don'ts

### Do
- Reserve the accent for emphasis: kickers, key numbers, links, chart series.
- Open content slides with a small uppercase kicker, then the headline.
- One idea per slide; prefer a designed slide to dense bullets.
- Keep to the type hierarchy; let size and color carry it.

### Don't
- Don't use the accent on large fills or long passages of text.
- Don't pack multiple ideas (or multiple charts) onto one slide.
- Don't mix many font weights or introduce off-system fonts.
- Don't add heavy shadows or decorative effects.

## Presenting & export
While presenting, arrows and a progress bar can be shown, plus optional page
numbers. In the exported PDF, arrows and the progress bar are dropped; page
numbers appear only if enabled.

## Tokens
The block below drives the actual colors, fonts, sizes and logo. Edit it directly
or by prompting.

\`\`\`clawnify-brand
{
  "colors": {
    "bg": "#FFFFFF",
    "text": "#1A1A1A",
    "heading": "#0A0A0A",
    "accent": "#6D4CFF",
    "muted": "#6B6B6B"
  },
  "fonts": {
    "heading": "Space Grotesk",
    "body": "Inter",
    "mono": "JetBrains Mono",
    "google": ["Space+Grotesk:wght@500;700", "Inter:wght@400;500;600", "JetBrains+Mono:wght@400"]
  },
  "sizes": { "heading": 72, "subheading": 44, "body": 24 },
  "radius": "14px",
  "logo": "",
  "logoPosition": "bottom-right",
  "textAlign": "left"
}
\`\`\`
`;

/** Pull the tokens object out of a DESIGN.md, falling back to defaults. */
export function parseTokens(designMd: string): BrandTokens {
  const m = designMd.match(/```[a-zA-Z]*\s*clawnify-brand\s*\n([\s\S]*?)```/);
  if (!m) return DEFAULTS;
  try {
    const raw = JSON.parse(m[1]);
    const s = raw.sizes || {};
    const sz = (v: unknown, d: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(12, Math.min(100, n)) : d; // clamp to 12–100
    };
    return {
      colors: { ...DEFAULTS.colors, ...(raw.colors || {}) },
      fonts: { ...DEFAULTS.fonts, ...(raw.fonts || {}) },
      sizes: {
        // Accept the legacy {hero,body} shape: hero → heading, derive subheading.
        heading: sz(s.heading ?? s.hero, DEFAULTS.sizes.heading),
        subheading: sz(s.subheading ?? (s.hero != null ? Number(s.hero) * 0.6 : undefined), DEFAULTS.sizes.subheading),
        body: sz(s.body, DEFAULTS.sizes.body),
      },
      radius: raw.radius || DEFAULTS.radius,
      logo: typeof raw.logo === "string" ? raw.logo : "",
      logoPosition: LOGO_POSITIONS.includes(raw.logoPosition) ? raw.logoPosition : DEFAULTS.logoPosition,
      textAlign: TEXT_ALIGNS.includes(raw.textAlign) ? raw.textAlign : DEFAULTS.textAlign,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Write tokens back into a DESIGN.md, replacing (or appending) the fenced block. */
export function setTokensInMd(designMd: string, tokens: BrandTokens): string {
  const json = JSON.stringify(tokens, null, 2);
  const block = "```clawnify-brand\n" + json + "\n```";
  const md = designMd || DEFAULT_BRAND_MD;
  const re = /```[a-zA-Z]*\s*clawnify-brand\s*\n[\s\S]*?```/;
  if (re.test(md)) return md.replace(re, block);
  return `${md.trimEnd()}\n\n## Tokens\n\n${block}\n`;
}

// Strip anything that could break out of a CSS string / style tag. Tokens come
// from the org's own brand doc, but defense-in-depth is cheap.
function css(v: string): string {
  return String(v).replace(/[<>{}]/g, "").slice(0, 200);
}

function fontStack(primary: string, kind: "sans" | "mono"): string {
  const has = /[, ]/.test(primary); // already a stack or a bare family name
  const fallback = kind === "mono" ? "ui-monospace, monospace" : "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  return has ? css(primary) : `'${css(primary)}', ${fallback}`;
}

/** CSS edge offsets placing the logo in the chosen corner. */
function logoCornerCss(pos: LogoPosition): string {
  const v = pos.startsWith("top") ? "top: 26px;" : "bottom: 26px;";
  const h = pos.endsWith("left") ? "left: 30px;" : "right: 30px;";
  return `${v} ${h}`;
}

/** <head> markup: web-font links + reveal variable overrides + logo styling. */
export function brandHead(tokens: BrandTokens): string {
  const c = tokens.colors;
  const fontLink = tokens.fonts.google.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${tokens.fonts.google
        .map((f) => `family=${encodeURIComponent(f).replace(/%2B/g, "+").replace(/%3A/g, ":").replace(/%40/g, "@").replace(/%3B/g, ";")}`)
        .join("&")}&display=swap" />`
    : "";

  return `${fontLink}
<style>
  :root, .reveal {
    --r-background-color: ${css(c.bg)};
    --r-main-color: ${css(c.text)};
    --r-heading-color: ${css(c.heading)};
    --r-link-color: ${css(c.accent)};
    --r-link-color-hover: ${css(c.accent)};
    --r-selection-background-color: ${css(c.accent)};
    --r-main-font: ${fontStack(tokens.fonts.body, "sans")};
    --r-heading-font: ${fontStack(tokens.fonts.heading, "sans")};
    --r-code-font: ${fontStack(tokens.fonts.mono, "mono")};
    --r-main-font-size: ${Math.round(tokens.sizes.body)}px;
    --r-heading1-size: ${Math.round(tokens.sizes.heading)}px;
    --brand-heading-size: ${Math.round(tokens.sizes.heading)}px;
    --brand-subheading-size: ${Math.round(tokens.sizes.subheading)}px;
    --brand-body-size: ${Math.round(tokens.sizes.body)}px;
    --brand-hero-size: ${Math.round(tokens.sizes.heading)}px; /* legacy alias of heading */
    --brand-bg: ${css(c.bg)};
    --brand-text: ${css(c.text)};
    --brand-heading: ${css(c.heading)};
    --brand-accent: ${css(c.accent)};
    --brand-muted: ${css(c.muted)};
    --brand-radius: ${css(tokens.radius)};
    --brand-align: ${tokens.textAlign === "center" ? "center" : "left"};
    --brand-justify: ${tokens.textAlign === "center" ? "center" : "flex-start"};
  }
  .reveal .muted { color: var(--brand-muted); }
  .reveal .accent { color: var(--brand-accent); }
  .reveal .kicker {
    font: 600 0.42em/1 var(--r-heading-font);
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--brand-accent);
  }
  /* position:fixed repeats on every printed page, so the logo shows on each PDF page too. */
  .brand-logo { position: fixed; height: 30px; opacity: 0.9; z-index: 40; ${logoCornerCss(tokens.logoPosition)} }
</style>`;
}

/** <img> overlay for the logo, or "" when none. `src` is already resolved. */
export function brandLogoTag(src: string): string {
  return src ? `<img class="brand-logo" src="${src.replace(/"/g, "&quot;")}" alt="" />` : "";
}

const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const fontName = (f: string) => (f.split(",")[0] || "System").replace(/['"]/g, "").trim() || "System";

/**
 * A visual brand-guidelines page (style guide) rendered with the brand's own
 * tokens & fonts — example slides + color palette + type scale. Shown alongside
 * the DESIGN.md prose so a brand reads as both a worked example and a spec.
 */
export function brandGuideHtml(name: string, tokens: BrandTokens, logoSrc = ""): string {
  const c = tokens.colors;
  // The example slide is a scaled-down 1280-wide canvas, so size its title/body
  // in container units derived from the px tokens (1 canvas px = 100/1280 cqw of
  // the slide's width). This makes the Hero/Body sliders visibly change the
  // preview, proportionally, instead of being ignored by fixed clamp() sizes.
  const headingCqw = (tokens.sizes.heading / 1280 * 100).toFixed(2);
  const bodyCqw = (tokens.sizes.body / 1280 * 100).toFixed(2);
  const headingPx = Math.round(tokens.sizes.heading);
  const subPx = Math.round(tokens.sizes.subheading);
  const bodyPx = Math.round(tokens.sizes.body);
  const swatch = (label: string, hex: string) =>
    `<div class="sw"><div class="chip" style="background:${css(hex)}"></div><div class="meta">${esc(label)}<div class="hex">${esc(hex)}</div></div></div>`;
  const lp = tokens.logoPosition;
  const logoCorner = `${lp.startsWith("top") ? "top:5%" : "bottom:5%"};${lp.endsWith("left") ? "left:6%" : "right:6%"}`;
  const logoImg = logoSrc ? `<img class="logo" style="${logoCorner}" src="${esc(logoSrc)}" alt="" />` : "";
  const logoSec = logoSrc
    ? `<div class="sec"><h2>Logo</h2><div class="logobox">${logoImg}</div></div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
${brandHead(tokens)}
<style>
  *{box-sizing:border-box} html,body{margin:0} body{background:#fff;color:#111;font-family:var(--r-main-font);padding:28px}
  .wrap{max-width:680px;margin:0 auto}
  .kicker{font:600 11px/1 var(--r-heading-font);letter-spacing:.18em;text-transform:uppercase;color:var(--brand-accent)}
  h1.name{font:700 36px/1 var(--r-heading-font);color:#111;margin:8px 0 26px;letter-spacing:-1px}
  .sec{margin:26px 0}
  .sec h2{font:600 11px/1 var(--r-main-font);letter-spacing:.12em;text-transform:uppercase;color:#9a9a9a;margin:0 0 12px}
  .slide{position:relative;container-type:inline-size;aspect-ratio:16/9;border-radius:14px;overflow:hidden;border:1px solid #eee;background:var(--brand-bg);padding:7% 8%;display:flex;flex-direction:column;justify-content:center;align-items:var(--brand-justify,flex-start);text-align:var(--brand-align,left)}
  .slide .logo{position:absolute;height:24px;opacity:.9}
  .logobox{display:inline-flex;align-items:center;justify-content:center;padding:22px 26px;border:1px solid #eee;border-radius:12px;background:var(--brand-bg)}
  .logobox .logo{height:40px;max-width:240px;object-fit:contain}
  .slide .k{font:600 13px/1 var(--r-heading-font);letter-spacing:.16em;text-transform:uppercase;color:var(--brand-accent)}
  .slide h3{font:700 ${headingCqw}cqw/1.04 var(--r-heading-font);color:var(--brand-heading);margin:8px 0 0;letter-spacing:-1px}
  .slide p{font:400 ${bodyCqw}cqw/1.4 var(--r-main-font);color:var(--brand-muted);margin:12px 0 0;max-width:72%}
  .swatches{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
  .sw{border:1px solid #eee;border-radius:10px;overflow:hidden}
  .sw .chip{height:44px}
  .sw .meta{padding:6px 8px;font:500 11px/1.3 var(--r-main-font);color:#333}
  .sw .hex{color:#9a9a9a;text-transform:uppercase;font-size:9px}
  .row{padding:12px 0;border-bottom:1px solid #f1f1f1}
  .row .spec{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lbl{font:500 10px/1 var(--r-main-font);color:#9a9a9a;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
</style></head><body><div class="wrap">
  <div class="kicker">Brand guidelines</div>
  <h1 class="name">${esc(name)}</h1>

  <div class="sec"><h2>Example slide</h2>
    <div class="slide"><div class="k">Your kicker</div><h3>Big bold title</h3><p>A supporting line in the body font and color, set on the brand canvas.</p>${logoImg}</div>
  </div>
  ${logoSec}

  <div class="sec"><h2>Colors</h2>
    <div class="swatches">
      ${swatch("Background", c.bg)}${swatch("Text", c.text)}${swatch("Heading", c.heading)}${swatch("Accent", c.accent)}${swatch("Muted", c.muted)}
    </div>
  </div>

  <div class="sec"><h2>Typography</h2>
    <div class="row"><div class="lbl">Heading · ${esc(fontName(tokens.fonts.heading))} · ${headingPx}px</div>
      <div class="spec" style="font:700 ${headingPx}px/1 var(--r-heading-font);color:var(--brand-heading);letter-spacing:-1px">Aa Bb Cc</div></div>
    <div class="row"><div class="lbl">Subheading · ${esc(fontName(tokens.fonts.heading))} · ${subPx}px</div>
      <div class="spec" style="font:700 ${subPx}px/1.1 var(--r-heading-font);color:var(--brand-heading);letter-spacing:-0.5px">Aa Bb Cc</div></div>
    <div class="row"><div class="lbl">Paragraph · ${esc(fontName(tokens.fonts.body))} · ${bodyPx}px</div>
      <div class="spec" style="font:400 ${bodyPx}px/1.5 var(--r-main-font);color:var(--brand-text)">The quick brown fox jumps over the lazy dog.</div></div>
  </div>
</div></body></html>`;
}
