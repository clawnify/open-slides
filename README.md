# Open Slides

An open-source, **agent-friendly slide maker**. Write presentations in plain
**Markdown**, drop in your own logos and images, **present fullscreen right in
the browser**, and export to **PDF**.

Built on **[reveal.js](https://github.com/hakimel/reveal.js)** (MIT) — so a deck
is just Markdown: humans can write it, and AI agents can author it end to end.
No proprietary slide format, no per-seat license.

## Why

Most slide tools lock your content into a binary format or a paid editor. Here a
deck is **Markdown you already know** — one idea per slide, slides separated by
`---`, styled by a reveal.js theme. That makes it trivial for an agent to
generate and trivial for a person to read and tweak.

## Features

- **Markdown editor** — write slides on the left, see them render live on the
  right. Slides split on `---`, speaker notes on `Note:`.
- **Present in the browser** — one click goes fullscreen with arrow-key
  navigation, speaker view, and a slide overview. Nothing to install.
- **Bring your own media** — upload logos and images and reference them by path
  (`![](assets/logo.png)`) right in the Markdown.
- **Export to PDF** — one click produces a clean, one-slide-per-page PDF you can
  share or print.
- **Themes** — pick from the full set of reveal.js themes (white, black, league,
  dracula, …).
- **Agent-ready** — a clean REST API (`/api/decks`, `/api/assets`) and an
  `agent.md` so an AI agent can author and present decks without a human in the
  loop.

## How a deck works

A deck is one Markdown document:

```markdown
# Your Presentation
### A subtitle

---

## Agenda

- Where we are
- What we're building
- What's next

Note: speaker notes show only in the speaker view.

---

## Thank you

Questions?
```

The editor renders those slides live and keeps your place as you edit.

## Quickstart

```bash
pnpm install
pnpm dev        # editor UI + API, with a local database & storage
```

Open the editor, hit **New deck** for a starter, write Markdown in the editor,
drop images in the **Images** panel, and click **Present**.

## Deploy

This is a [Clawnify](https://clawnify.com) app — deploy it to your org with the
CLI:

```bash
npx clawnify deploy
```

PDF export runs on Clawnify's managed render service, so deployed instances need
no local browser or PDF toolchain.

## Project layout

```
src/
  client/app.tsx     # editor UI: decks, Markdown, live preview, present, export
  server/            # REST API (decks, assets) + reveal.js view + PDF export
agent.md             # how an AI agent authors and presents decks
```

## License

MIT for this app. reveal.js is MIT.
