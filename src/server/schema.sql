-- Decks: a reveal.js presentation authored as Markdown. Slides are separated by
-- a line containing `---` (vertical stacks by `--`); speaker notes by `Note:`.
-- `theme` is a reveal.js theme name (white, black, league, …).
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'white',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Media library: logos and images the user uploads. Stored in R2 under `key`;
-- the deck Markdown references them as `assets/<key>` (e.g. ![](assets/logo.png)).
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
