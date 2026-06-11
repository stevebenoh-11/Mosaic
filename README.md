# Mosaic

A local-first visual thinking workspace — freeform boards of notes, images,
links and ideas on an infinite canvas. Installable as a PWA on desktop and
mobile, fully usable offline, with optional cross-device sync through your own
Google Drive.

> Status: in active development, milestone by milestone (see `DECISIONS.md`).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # type-check + production build
npm run icons      # regenerate PWA icons from the SVG mark
```

## Architecture (short version)

- **Local-first**: IndexedDB (Dexie) is the source of truth; the UI reads a
  Zustand store that mirrors it. Google Drive (M6) is a sync layer on top.
- **Single mutation funnel**: every change is a command (`before`/`after` per
  entity) → store → debounced autosave to Dexie → sync outbox. This makes
  undo/redo complete and sync reliable by construction.
- **DOM canvas**: cards are absolutely-positioned divs in a translated/scaled
  world container; SVG overlay for connectors and drawings.

More docs (install-as-app guide, shortcuts, Google setup) land with M5/M6.
