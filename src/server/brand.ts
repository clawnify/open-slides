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
  sizes: { hero: number; body: number }; // px — Hero (title) + Body text scale
  radius: string;
  logo: string; // "assets/<key>" or a URL, or "" for none
}

const DEFAULTS: BrandTokens = {
  colors: { bg: "#FFFFFF", text: "#1A1814", heading: "#111111", accent: "#6D4CFF", muted: "#6F6A63" },
  fonts: {
    heading: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    google: [],
  },
  sizes: { hero: 96, body: 34 },
  radius: "14px",
  logo: "",
};

export const DEFAULT_BRAND_MD = `# Brand design system

This is a full design system, not just colors. The AI reads it before authoring
slides — the prose below guides LAYOUT and VOICE, and the \`clawnify-brand\` block
drives the exact colors, fonts and logo. Edit either by hand or by prompting.

## Voice
Confident, concise, plain-spoken. One idea per slide. No filler words.

## Look & feel
Clean and high-contrast. Big type, generous whitespace, a single accent color
used sparingly for emphasis (never for large fills).

## Layout
- Designed slides are full-bleed 1280×720 and LEFT-aligned, content vertically
  centered, with ~9% side padding.
- Start most content slides with a small uppercase accent kicker, then the
  headline, then one supporting line.
- One focal point per slide: a headline, a single stat, one image, or one quote.
- Prefer a designed slide over a wall of bullets; if you use bullets, keep them
  to 3–5 short lines.

## Components
- Kicker: \`class="kicker"\` — small uppercase accent eyebrow.
- Title: the display font at \`var(--brand-hero-size)\`.
- Body / captions: the body font at \`var(--brand-body-size)\`, muted color.
- Big stat: the accent color at a very large size.

## Tokens

\`\`\`clawnify-brand
{
  "colors": {
    "bg": "#FFFFFF",
    "text": "#1A1814",
    "heading": "#111111",
    "accent": "#6D4CFF",
    "muted": "#6F6A63"
  },
  "fonts": {
    "heading": "Space Grotesk",
    "body": "Inter",
    "mono": "JetBrains Mono",
    "google": ["Space+Grotesk:wght@500;700", "Inter:wght@400;500;600", "JetBrains+Mono:wght@400;500"]
  },
  "radius": "14px",
  "logo": ""
}
\`\`\`

## Anti-patterns
- Walls of text. Bullets over paragraphs; ideally one statement per slide.
- More than one accent color, or accent used for large fills.
- Low-contrast gray-on-gray text.
`;

/** Pull the tokens object out of a DESIGN.md, falling back to defaults. */
export function parseTokens(designMd: string): BrandTokens {
  const m = designMd.match(/```[a-zA-Z]*\s*clawnify-brand\s*\n([\s\S]*?)```/);
  if (!m) return DEFAULTS;
  try {
    const raw = JSON.parse(m[1]);
    return {
      colors: { ...DEFAULTS.colors, ...(raw.colors || {}) },
      fonts: { ...DEFAULTS.fonts, ...(raw.fonts || {}) },
      sizes: { ...DEFAULTS.sizes, ...(raw.sizes || {}) },
      radius: raw.radius || DEFAULTS.radius,
      logo: typeof raw.logo === "string" ? raw.logo : "",
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
    --r-heading1-size: ${Math.round(tokens.sizes.hero)}px;
    --brand-hero-size: ${Math.round(tokens.sizes.hero)}px;
    --brand-body-size: ${Math.round(tokens.sizes.body)}px;
    --brand-bg: ${css(c.bg)};
    --brand-text: ${css(c.text)};
    --brand-heading: ${css(c.heading)};
    --brand-accent: ${css(c.accent)};
    --brand-muted: ${css(c.muted)};
    --brand-radius: ${css(tokens.radius)};
  }
  .reveal .muted { color: var(--brand-muted); }
  .reveal .accent { color: var(--brand-accent); }
  .reveal .kicker {
    font: 600 0.42em/1 var(--r-heading-font);
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--brand-accent);
  }
  /* position:fixed repeats on every printed page, so the logo shows on each PDF page too. */
  .brand-logo { position: fixed; bottom: 26px; right: 30px; height: 30px; opacity: 0.9; z-index: 40; }
</style>`;
}

/** <img> overlay for the logo, or "" when none. `src` is already resolved. */
export function brandLogoTag(src: string): string {
  return src ? `<img class="brand-logo" src="${src.replace(/"/g, "&quot;")}" alt="" />` : "";
}
