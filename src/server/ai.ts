// Natural-language slide generation. The user describes what they want; we ask
// an LLM (via the org's injected OPENROUTER_API_KEY — the platform standard) to
// author slides in this app's format, grounded in the active brand so output is
// on-brand and layout-consistent.

import { generateText, tool, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { BrandTokens } from "./brand";
import type { SlideTemplate } from "./templates";

// Provider-agnostic via the Vercel AI SDK. Works with a direct Anthropic key
// (BYOK) or OpenRouter (platform standard); Anthropic wins when both are set.
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";

export type AiEnv = { ANTHROPIC_API_KEY?: string; OPENROUTER_API_KEY?: string };
export const hasAiKey = (env: AiEnv) => !!(env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY);

// OpenRouter attribution — always credit the platform, so usage rolls up under
// Clawnify rather than per-app.
const OPENROUTER_ATTRIBUTION = {
  "HTTP-Referer": "https://clawnify.com",
  "X-Title": "Clawnify",
};

function model(env: AiEnv): LanguageModel {
  if (env.ANTHROPIC_API_KEY) return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(ANTHROPIC_MODEL);
  if (env.OPENROUTER_API_KEY) {
    return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY, headers: OPENROUTER_ATTRIBUTION })(OPENROUTER_MODEL);
  }
  throw new Error("AI generation unavailable: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.");
}

// One authored slide: the slide markup plus its speaker notes (the per-slide
// store of intent/context — see docs). Both come from the model's tool calls;
// the deck-ops layer assembles them into a deck chunk.
export interface AuthoredSlide { content: string; notes: string }
export interface DeckSlide { index: number; notes: string; content: string }

// The deck the agent operates on. Each verb mutates + persists + streams the
// deck (implemented by the SSE endpoint); the agent just calls them in a loop.
// This is the whole "harness": small composable tools over a live deck.
export interface DeckOps {
  read(): Promise<DeckSlide[]>;
  add(slide: AuthoredSlide, afterIndex?: number): Promise<number>; // → new slide's index
  edit(index: number, slide: AuthoredSlide): Promise<void>;
  remove(index: number): Promise<void>;
}

interface GenInput {
  prompt: string;
  tokens: BrandTokens;
  designMd: string; // the brand's full DESIGN.md (prose layout/voice guidance + tokens)
  templates: SlideTemplate[];
  currentIndex?: number; // the slide the user is looking at
  deck: DeckSlide[]; // the deck's current slides (indexed) at the start of the turn
}

function listDeck(deck: DeckSlide[]): string {
  if (!deck.length) return "(empty deck)";
  return deck
    .map((s) => `[${s.index}] ${s.notes || "(no notes)"}\n${s.content}`)
    .join("\n---\n");
}

function systemPrompt(tokens: BrandTokens, templates: SlideTemplate[]): string {
  return `You are a slide designer for "Open Slides", a reveal.js deck tool. You build and refine decks by calling small tools in a loop, and you ALWAYS match the brand.

## How you work (a multi-step loop)
1. Call \`read_brand_design\` FIRST to study the brand's voice, layout, spacing and rules.
2. Then act on the deck with these verbs, ONE slide at a time — each call takes effect immediately, so the user watches the deck change live:
   - \`add_slide\` — append a new slide (or insert after a given index).
   - \`edit_slide\` — replace the slide at an index with new content (use this to refine/fix an existing slide).
   - \`delete_slide\` — remove the slide at an index.
   - \`read_deck\` — re-read the current slides with their indices and notes (indices shift after add/delete, so re-read if unsure).
3. Stop when the deck satisfies the request.

Match the work to the request:
- "edit/fix/refine this slide" → ONE edit_slide on the current slide.
- "add a slide about…" → add_slide(s) after the current slide.
- "make a deck about…" / "start over" → turn the current slides INTO the new deck: edit the existing slides in place and add/delete as needed (don't leave leftover placeholder slides).

## Each slide is designed HTML on a 1280x720 canvas
- Wrap the slide's content in:
  \`<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 9%;box-sizing:border-box"> ... </div>\`
- ALIGNMENT: do NOT put text-align / align-items on the wrapper — the slide
  inherits the brand's alignment by default (a guideline, kept consistent across
  the deck). Override it on a single slide ONLY when the layout needs it — e.g.
  left-align a slide with a chart even if the brand default is centered: add
  \`align-items:flex-start;text-align:left\` to that one wrapper.
- Style with the BRAND CSS VARIABLES (never hardcode brand colors/fonts):
  --brand-bg, --brand-text, --brand-heading, --brand-accent, --brand-muted,
  --brand-heading-size, --brand-subheading-size, --brand-body-size, --brand-radius,
  --r-heading-font (display font), --r-main-font (body font).
- SIZES: the brand defines three sizes — heading (h1), subheading (h2) and body.
  Plain \`<h1>\`, \`<h2>\`, \`<h3>\` and \`<p>\`/\`<li>\` already inherit the brand
  scale, so OMIT font-size on them. If you do set one, use the matching variable
  (\`var(--brand-heading-size)\`, \`var(--brand-subheading-size)\`,
  \`var(--brand-body-size)\`) — the canvas is a fixed 1280x720, so never use vw/clamp.
  Set an explicit px size only for a deliberately special element (a big stat, a small caption).
  Example title: \`<h1 style="font-weight:700;color:var(--brand-heading)">...</h1>\` (size inherited)
  Use \`class="kicker"\` for a small uppercase accent eyebrow.
- BACKGROUND: do NOT set a per-slide background. Every slide sits on the brand
  canvas (--brand-bg) automatically, and that keeps the deck on-brand. ONLY add a
  \`<!-- .slide: data-background-color="#xxxxxx" -->\` first line if the user
  EXPLICITLY asks for a specific slide background, and even then prefer the
  brand's own bg/accent colors (from the tokens) over an arbitrary color. You may
  use data-background-image="assets/<name>" for a full-bleed image the user provided.
- Charts: to show data, add \`<div class="chart" style="height:380px" data-chart='{"type":"bar","labels":["Q1","Q2"],"data":[12,19]}'></div>\` — type is bar | line | donut. It renders as on-brand SVG automatically; do NOT add your own colors or styling inside it. Give the chart div a height (or flex:1 with min-height:0 inside a flex column).
- Entrance animations (optional): add \`class="fragment fade-up"\` to elements that should animate in on click. Effects: fade-up, fade-down, fade-left, fade-right, zoom-in, grow. They play only while presenting.
- Only reference images the user explicitly provides as \`assets/<name>\`; otherwise omit images.

## Speaker notes — ALWAYS write them
add_slide and edit_slide take a \`notes\` field: 1-3 sentences of speaker notes for
that slide (what the presenter should say / the point of the slide). These show in
the presenter view, never on the slide or in the PDF, and they are the slide's
memory — when refining a deck later, the notes tell you what each slide is for.

(Brand tokens, also available as the CSS variables above: ${JSON.stringify(tokens, null, 0)})

## Available layout templates (reuse these shapes for consistency)
${templates.map((t) => `- ${t.name}`).join("\n")}

## Critical
- Keep ONE idea per slide. Short, punchy copy. No code fences, no commentary in the slide markup.`;
}

// The tool loop. The model reads the brand and the deck, then mutates the deck
// one slide at a time through the DeckOps verbs; each verb persists + streams the
// change before the model continues.
export async function generate(env: AiEnv, input: GenInput, ops: DeckOps): Promise<void> {
  const tools = {
    read_brand_design: tool({
      description: "Read the active brand's full DESIGN.md — its voice, layout system, spacing and guidelines. Call this before writing slides.",
      inputSchema: z.object({}),
      execute: async () => input.designMd,
    }),
    read_deck: tool({
      description: "List the deck's current slides with their indices and speaker notes. Indices are 0-based and shift after add/delete — re-read if unsure.",
      inputSchema: z.object({}),
      execute: async () => listDeck(await ops.read()),
    }),
    add_slide: tool({
      description: "Add ONE new slide. Appends to the end, or inserts right after `after_index` if given. The slide appears immediately.",
      inputSchema: z.object({
        content: z.string().describe("The slide's designed HTML (the wrapper div and its contents). No code fences."),
        notes: z.string().describe("1-3 sentences of speaker notes for this slide."),
        after_index: z.number().int().optional().describe("Insert after this 0-based index; omit to append at the end."),
      }),
      execute: async ({ content, notes, after_index }) => {
        try {
          const i = await ops.add({ content: stripFence(content.trim()), notes: notes.trim() }, after_index);
          return `added as slide ${i}.`;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
    edit_slide: tool({
      description: "Replace the slide at `index` with new content + notes. Use this to refine, fix or restyle an existing slide.",
      inputSchema: z.object({
        index: z.number().int().describe("0-based index of the slide to replace."),
        content: z.string().describe("The slide's new designed HTML. No code fences."),
        notes: z.string().describe("1-3 sentences of speaker notes for this slide."),
      }),
      execute: async ({ index, content, notes }) => {
        try {
          await ops.edit(index, { content: stripFence(content.trim()), notes: notes.trim() });
          return `edited slide ${index}.`;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
    delete_slide: tool({
      description: "Delete the slide at `index`. Remaining slides shift down by one.",
      inputSchema: z.object({ index: z.number().int().describe("0-based index of the slide to delete.") }),
      execute: async ({ index }) => {
        try {
          await ops.remove(index);
          return `deleted slide ${index}.`;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
  };

  await generateText({
    model: model(env),
    system: systemPrompt(input.tokens, input.templates),
    prompt: `The user is currently looking at slide ${input.currentIndex ?? 0}.

CURRENT DECK (index, notes, then the slide HTML):
${listDeck(input.deck)}

REQUEST:
${input.prompt}`,
    tools,
    stopWhen: stepCountIs(40),
    maxOutputTokens: 8000,
    temperature: 0.6,
  });
}

// Models sometimes wrap output in ```; strip a single outer fence if present.
function stripFence(s: string): string {
  const m = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : s).trim();
}

// ── Brand editing (multi-step agent loop) ───────────────────────────
// A brand is one DESIGN.md: prose guidance + a fenced clawnify-brand tokens
// block. The agent edits it through composable verbs — adjust tokens (the
// visual system) and rewrite the guidelines prose — and each verb persists +
// streams the brand so the preview updates live, mirroring the deck loop.

// A subset of token fields to patch; the ops layer deep-merges into the current
// tokens. Mirrors BrandTokens (all optional).
export interface BrandTokensPatch {
  colors?: Partial<BrandTokens["colors"]>;
  fonts?: Partial<BrandTokens["fonts"]>;
  sizes?: Partial<BrandTokens["sizes"]>;
  radius?: string;
  logoPosition?: BrandTokens["logoPosition"];
  textAlign?: BrandTokens["textAlign"];
}

export interface BrandOps {
  read(): Promise<string>; // current DESIGN.md (prose + tokens)
  updateTokens(patch: BrandTokensPatch): Promise<void>; // merge + persist + stream
  editGuidelines(oldStr: string, newStr: string): Promise<void>; // surgical prose replace
  writeGuidelines(markdown: string): Promise<void>; // full prose rewrite, keep tokens
}

export async function editBrand(
  env: AiEnv,
  input: { instruction: string; currentMd: string },
  ops: BrandOps,
): Promise<void> {
  const system = `You edit a brand design system for "Open Slides" by calling small tools in a loop. A brand is a DESIGN.md: written guidelines (prose) plus a machine-readable token set that drives every slide's colors, fonts, sizes, logo and alignment.

## How you work
1. Call \`read_brand\` to see the current guidelines + tokens.
2. Apply the user's instruction with these verbs — each takes effect immediately, so the user watches the brand update live:
   - \`update_tokens\` — change the visual system / UI (any subset of: colors, fonts, sizes, radius, logoPosition, textAlign).
   - \`edit_guidelines\` — SURGICALLY edit the written guidelines: replace an exact snippet of prose with new text. Prefer this for targeted wording/section changes — copy the exact text from read_brand. (Don't use it on token values; use update_tokens for those.)
   - \`write_guidelines\` — replace the WHOLE guidelines prose. Use only for a big restructure or when there's no prose yet.
3. Stop when the brand reflects the instruction.

Keep visuals and prose IN SYNC: when the instruction implies a visual change ("darker", "more playful", "serif display", "vibrant accent"), update_tokens AND write_guidelines — never change only the prose. "Darker" → lower bg/text lightness + note it in the voice; "playful" → rounder radius, brighter accent; "serif display" → fonts.heading + the matching google spec + mention it in Typography.

## Token rules
- colors are hex ("#1A1814"). The five roles: bg (canvas), text (body ink), heading, accent (one emphasis color), muted.
- fonts.heading/body/mono are family names. For a Google font, set the family AND add its spec to fonts.google (e.g. "Playfair+Display:wght@500;700"); for a system font use a stack like "Georgia, serif" and drop it from google.
- sizes.heading / sizes.subheading / sizes.body are px numbers from 12 to 100 (h1, h2 and body text scale).
- textAlign is "left" or "center" (applies deck-wide). radius is a CSS length ("14px").
- Keep the guidelines a real design system (sections + voice), not just a token dump. Always keep an "Example slides" section with AT LEAST THREE concrete example slides (HTML using the brand variables) — they show the system in practice and ground slide generation.`;

  const tools = {
    read_brand: tool({
      description: "Read the current brand DESIGN.md — its written guidelines and token values.",
      inputSchema: z.object({}),
      execute: async () => ops.read(),
    }),
    update_tokens: tool({
      description: "Change the visual tokens. Pass only the fields you want to change; the rest are kept. Applies immediately.",
      inputSchema: z.object({
        colors: z.object({
          bg: z.string().optional(), text: z.string().optional(), heading: z.string().optional(),
          accent: z.string().optional(), muted: z.string().optional(),
        }).optional(),
        fonts: z.object({
          heading: z.string().optional(), body: z.string().optional(), mono: z.string().optional(),
          google: z.array(z.string()).optional(),
        }).optional(),
        sizes: z.object({ heading: z.number().optional(), subheading: z.number().optional(), body: z.number().optional() }).optional(),
        radius: z.string().optional(),
        logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
        textAlign: z.enum(["left", "center"]).optional(),
      }),
      execute: async (patch) => {
        try { await ops.updateTokens(patch); return "tokens updated."; }
        catch (e) { return `error: ${e instanceof Error ? e.message : String(e)}`; }
      },
    }),
    edit_guidelines: tool({
      description: "Surgically edit the written guidelines: replace one exact snippet of existing prose with new text. Copy old_str verbatim from read_brand (include enough context to be unique).",
      inputSchema: z.object({
        old_str: z.string().describe("The exact existing prose to replace (must match verbatim and be unique)."),
        new_str: z.string().describe("The replacement text."),
      }),
      execute: async ({ old_str, new_str }) => {
        try { await ops.editGuidelines(old_str, new_str); return "guidelines edited."; }
        catch (e) { return `error: ${e instanceof Error ? e.message : String(e)}`; }
      },
    }),
    write_guidelines: tool({
      description: "Replace the ENTIRE written guidelines prose (around the tokens). Use only for a big restructure or initial authoring; prefer edit_guidelines for targeted changes. Keep it a real design system: overview, type, color and layout guidance + voice.",
      inputSchema: z.object({ markdown: z.string().describe("The full guidelines markdown (no tokens block, no code fences).") }),
      execute: async ({ markdown }) => {
        try { await ops.writeGuidelines(stripFence(markdown.trim())); return "guidelines rewritten."; }
        catch (e) { return `error: ${e instanceof Error ? e.message : String(e)}`; }
      },
    }),
  };

  await generateText({
    model: model(env),
    system,
    prompt: `CURRENT BRAND:\n${input.currentMd}\n\nINSTRUCTION:\n${input.instruction}`,
    tools,
    stopWhen: stepCountIs(20),
    maxOutputTokens: 6000,
    temperature: 0.6,
  });
}
