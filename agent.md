# Open Slides — agent guide

This app turns **Markdown into reveal.js slide decks**. You author decks as
Markdown, the user drops in logos/images, presents fullscreen in the browser,
and exports to PDF on the managed Clawnify render service. You never touch a
browser or a PDF toolchain — you write Markdown and call this app's API.

Base URL: this app's own origin. All endpoints are under `/api`.

## Deck format

A deck is one Markdown document. Slides are separated by a line containing only
`---`. Vertical (nested) slides use `--`. Speaker notes start a line with
`Note:`.

```markdown
# Title slide
### A subtitle

---

## Second slide

- bullet one
- bullet two

Note: this line only shows in the speaker view.

---

## Image slide

![logo](assets/logo.png)
```

Standard Markdown works: headings, lists, blockquotes, tables, fenced code
blocks (syntax-highlighted), and images. Per-slide reveal.js options can be set
with HTML comment attributes, e.g. `<!-- .slide: data-background="#1a1814" -->`.

## Embedding the user's media

Images the user uploads live in the **Images** library and are referenced from
the Markdown by path: `assets/<key>`. Use `![alt](assets/<key>)`. On PDF export
the app inlines referenced images automatically — you don't attach them.

List what's available: `GET /api/assets` → `[{ key, name, content_type }]`. Use
the exact `key` in `assets/<key>`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/decks` | List decks |
| GET  | `/api/decks/{id}` | Get one (includes `content`) |
| POST | `/api/decks` | Create `{ title, content?, theme? }` |
| PUT  | `/api/decks/{id}` | Update any of `title/content/theme` |
| DELETE | `/api/decks/{id}` | Delete |
| GET  | `/api/decks/{id}/view` | Interactive reveal.js deck (HTML) |
| GET  | `/api/decks/{id}/pdf` | Export to PDF (one slide per page) |
| GET  | `/api/assets` | List uploaded images |
| POST | `/api/assets` | Upload an image (multipart `file`) |

`theme` is a reveal.js theme name: `white`, `black`, `league`, `beige`, `sky`,
`night`, `serif`, `simple`, `solarized`, `moon`, `dracula`, `blood`.

## Authoring flow

1. Read the brief. Pick a theme that fits the tone (light decks: `white` /
   `simple`; dark decks: `black` / `dracula`).
2. `GET /api/assets` to see the user's logo / images and their `key`s.
3. Write the deck as Markdown — one idea per slide, slides split by `---` —
   and `POST /api/decks` (or `PUT` to revise).
4. The user presents it in-app (fullscreen) or you can hand them
   `GET /api/decks/{id}/pdf` for a shareable PDF.

## How export works (so you can reason about failures)

`GET /api/decks/{id}/pdf` builds a print-mode reveal.js page and sends it to
Clawnify's managed PDF service, which returns one PDF page per slide. The app
does no rendering itself. A `503` means PDF export isn't configured (no managed
token — only happens in local dev). A `502` means the render service rejected
the deck; the `detail` field explains why.
