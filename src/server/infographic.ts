// Infographics. A slide can carry a declarative infographic written in the
// @antv/infographic text DSL inside a marked <script>; at serve time we render
// it to a brand-themed inline SVG (the same "convert to image" idea used for
// charts), so it's static in the editor, present, thumbnails and the PDF with no
// runtime dependency in the iframe.
//
// Authoring shape (what agents/templates write into a slide):
//   <div class="infographic" style="flex:1;min-height:0">
//   <script type="text/x-infographic">
//   infographic sequence-steps-simple
//   data
//     title Our rollout
//     lists
//       - label Discover
//         desc Research and scope
//   </script>
//   </div>
//
// The heavy renderer (@antv/infographic ≈ d3 + roughjs + linkedom) is imported
// dynamically, so decks without an infographic never load it.

export interface InfographicTheme {
  colorPrimary?: string; // brand accent
  colorBg?: string; // brand canvas
}

// Matches an infographic block and captures the wrapping div's attributes and
// the DSL inside its <script type="text/x-infographic">.
const BLOCK_RE =
  /<div([^>]*\bclass="[^"]*\binfographic\b[^"]*"[^>]*)>\s*<script\s+type="text\/x-infographic">([\s\S]*?)<\/script>\s*<\/div>/gi;

export function hasInfographics(content: string): boolean {
  BLOCK_RE.lastIndex = 0;
  return BLOCK_RE.test(content);
}

// Some models HTML-escape the DSL; undo the common entities so the parser sees
// raw text. (DSL is plain text — labels rarely contain these.)
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Strip the XML prolog/stylesheet PI and make the SVG scale to its container:
// drop fixed width/height, keep the viewBox, and size it to fill + center via the
// `style` — MERGING into any existing style (antv sets style="background-color:…",
// and a duplicate style attribute would be ignored, leaving the SVG unsized).
function cleanSvg(raw: string): string {
  const i = raw.indexOf("<svg");
  if (i < 0) return "";
  let svg = raw.slice(i);
  // Size to the SVG's intrinsic ratio (from its viewBox): full width, natural
  // height — so a wide/short infographic stays short instead of ballooning to
  // fill a flex:1 box. Cap the height so a tall template can't overflow the slide.
  const sizeCss = "width:100%;height:auto;max-height:440px;display:block;margin:0 auto";
  svg = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    let a = attrs.replace(/\s(?:width|height)="[^"]*"/g, "");
    if (/\sstyle="/.test(a)) a = a.replace(/\sstyle="([^"]*)"/, (_s, st) => ` style="${st};${sizeCss}"`);
    else a += ` style="${sizeCss}"`;
    if (!/preserveAspectRatio=/.test(a)) a += ' preserveAspectRatio="xMidYMid meet"';
    return `<svg${a}>`;
  });
  return svg;
}

// Replace each infographic block with a rendered, brand-themed SVG. Returns the
// content unchanged (and never imports the renderer) when there are none.
export async function bakeInfographics(content: string, theme: InfographicTheme): Promise<string> {
  if (!hasInfographics(content)) return content;

  const { renderToString } = await import("@antv/infographic/ssr");

  const blocks: { match: string; attrs: string; dsl: string }[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(content))) blocks.push({ match: m[0], attrs: m[1], dsl: decodeEntities(m[2]).trim() });

  let out = content;
  for (const b of blocks) {
    let body: string;
    try {
      const raw = await renderToString(b.dsl, {
        themeConfig: { colorPrimary: theme.colorPrimary, colorBg: theme.colorBg },
        svg: { background: false },
      });
      body = cleanSvg(raw) || errorBox("Infographic failed to render");
    } catch (e) {
      body = errorBox(`Infographic error: ${e instanceof Error ? e.message : String(e)}`);
    }
    out = out.replace(b.match, `<div${b.attrs}>${body}</div>`);
  }
  return out;
}

function errorBox(msg: string): string {
  const safe = msg.replace(/[<>&]/g, "").slice(0, 200);
  return `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--brand-muted,#999);font:400 14px/1.4 var(--r-main-font,sans-serif);text-align:center;padding:1em">${safe}</div>`;
}
