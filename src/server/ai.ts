// Natural-language slide generation. The user describes what they want; we ask
// an LLM (via the org's injected OPENROUTER_API_KEY — the platform standard) to
// author slides in this app's format, grounded in the active brand so output is
// on-brand and layout-consistent.

import { generateText, type LanguageModel } from "ai";
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

export type GenAction = "edit_current" | "add_slides" | "replace_deck";
export interface GenResult { action: GenAction; content: string }

interface GenInput {
  prompt: string;
  tokens: BrandTokens;
  designMd: string; // the brand's full DESIGN.md (prose layout/voice guidance + tokens)
  templates: SlideTemplate[];
  currentSlide?: string;
  deckContext?: string;
}

function systemPrompt(tokens: BrandTokens, designMd: string, templates: SlideTemplate[]): string {
  return `You are a slide designer for "Open Slides", a reveal.js deck tool. You write slides in a simple document format and you ALWAYS match the brand.

## Output format
A deck is one document. Slides are separated by a line containing only \`---\`.
EVERY slide is a designed HTML slide laying out a full 1280x720 canvas. Do NOT
write markdown — it is not supported.

## Designed slide rules
- Wrap each slide's content in:
  \`<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;padding:0 9%;box-sizing:border-box"> ... </div>\`
- Style with the BRAND CSS VARIABLES (never hardcode brand colors/fonts):
  --brand-bg, --brand-text, --brand-heading, --brand-accent, --brand-muted,
  --brand-hero-size (title size), --brand-body-size (body size), --brand-radius,
  --r-heading-font (display font), --r-main-font (body font).
  Example title: \`<h1 style="font:700 var(--brand-hero-size)/1.02 var(--r-heading-font);color:var(--brand-heading)">...</h1>\`
  Use \`class="kicker"\` for a small uppercase accent eyebrow.
- Per-slide background (optional): put \`<!-- .slide: data-background-color="#xxxxxx" -->\` as the slide's FIRST line. You may also use data-background-gradient or data-background-image="assets/<name>".
- Speaker notes (optional): add \`<aside class="notes">…</aside>\` inside the slide; it shows only in the presenter view, never on the slide or in the PDF.
- Entrance animations (optional): add \`class="fragment fade-up"\` to elements that should animate in on click. Effects: fade-up, fade-down, fade-left, fade-right, zoom-in, grow. They play only while presenting.
- Charts: to show data, add \`<div class="chart" style="height:380px" data-chart='{"type":"bar","labels":["Q1","Q2"],"data":[12,19]}'></div>\` — type is bar | line | donut. It renders as on-brand SVG automatically; do NOT add your own colors or styling inside it. Give the chart div a height (or flex:1 with min-height:0 inside a flex column).
- Only reference images the user explicitly provides as \`assets/<name>\`; otherwise omit images.

## Brand design system — FOLLOW its layout, spacing, voice and guidelines
${designMd}

(The tokens in that document are also available as CSS variables: ${JSON.stringify(tokens, null, 0)})

## Available layout templates (reuse these shapes for consistency)
${templates.map((t) => `- ${t.name}`).join("\n")}

## Decide the action
Read the request together with the current slide and the deck, then pick ONE:
- edit_current — change/refine/fix the CURRENT slide. This is the DEFAULT and most common case: when the request describes content that fits one slide and a current slide exists, edit it.
- add_slides — the user clearly wants to ADD new slide(s) ("add a slide about…", "a slide for…", "another slide…").
- replace_deck — the user wants to build or replace the WHOLE presentation ("make a deck about…", "create a presentation…", "start over").

## Critical
- Keep ONE idea per slide. Short, punchy copy.
- Respond EXACTLY in this format and nothing else:
ACTION: <edit_current|add_slides|replace_deck>
===
<the slide document — exactly ONE slide for edit_current; one or more slides separated by lines of \`---\` otherwise. No code fences, no commentary.>`;
}

async function call(env: AiEnv, system: string, user: string): Promise<string> {
  const { text } = await generateText({
    model: model(env),
    system,
    prompt: user,
    maxOutputTokens: 3000,
    temperature: 0.6,
  });
  return text.trim();
}

// Models sometimes wrap output in ```; strip a single outer fence if present.
function stripFence(s: string): string {
  const m = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : s).trim();
}

export async function generate(env: AiEnv, input: GenInput): Promise<GenResult> {
  const system = systemPrompt(input.tokens, input.designMd, input.templates);
  const user = `CURRENT SLIDE (the one the user is looking at):
${input.currentSlide || "(none)"}

FULL DECK:
${input.deckContext || "(empty)"}

REQUEST:
${input.prompt}`;

  const raw = await call(env, system, user);

  // Parse "ACTION: <x>\n===\n<content>"; fall back to a safe add.
  const m = raw.match(/ACTION:\s*(edit_current|add_slides|replace_deck)\s*\n=+\s*\n([\s\S]*)$/i);
  if (m) return { action: m[1].toLowerCase() as GenAction, content: stripFence(m[2].trim()) };
  return { action: "add_slides", content: stripFence(raw) };
}

// Edit a brand's DESIGN.md by natural-language instruction. Returns the full
// updated DESIGN.md (keeping the fenced clawnify-brand tokens block valid).
export async function editBrand(
  env: AiEnv,
  opts: { instruction: string; currentMd: string },
): Promise<string> {
  const system = `You edit a brand design system written as a DESIGN.md. It contains prose plus a fenced \`clawnify-brand\` block of JSON tokens:
{ "colors": { "bg","text","heading","accent","muted" (hex) },
  "fonts": { "heading","body","mono" (family names), "google": ["Family+Name:wght@400;700", ...] },
  "sizes": { "hero","body" (numbers, px) },
  "radius": "14px", "logo": "" }

Apply the user's instruction (e.g. "make it darker and more playful", "use a serif display font", "more vibrant accent"). Rules:
- Reflect the change in BOTH the tokens AND the prose, so the visual design and the written guidelines stay in sync. "Darker" → update colors (bg/text) AND the look/voice prose. "Playful" → maybe a rounder radius, brighter accent, and a note in voice. "Serif display" → update fonts.heading + google AND mention it in Typography. Never change only the prose when the instruction implies a visual change.
- Keep the \`clawnify-brand\` block present and VALID JSON.
- When you change a font to a Google font, set fonts.google to the correct specs (e.g. "Playfair+Display:wght@500;700"); for system fonts use "Georgia, serif" / "-apple-system, ..." and drop it from google.
- Keep colors as hex. Preserve the document's section structure (it's a full design system, not just tokens).
- Return ONLY the full updated DESIGN.md (no code fences around the whole thing, no commentary).`;
  const user = `Current DESIGN.md:\n\n${opts.currentMd}\n\nInstruction:\n${opts.instruction}`;
  return stripFence(await call(env, system, user));
}
