# Mosaic

A local-first visual thinking workspace — freeform boards of notes, images,
links, to-dos and ideas on an infinite canvas. Installable as a PWA on desktop
and mobile, fully usable offline, with optional cross-device sync through your
own Google Drive (see `SETUP_GOOGLE.md`, lands with M6).

![Mosaic](public/favicon.svg)

## Features

- Infinite canvas boards with pan, zoom (10–400%), snap-to-align guides,
  marquee selection, full undo/redo of every operation
- Cards: rich-text notes (TipTap), titles, images, link previews, to-do lists,
  color swatches, columns that stack cards, connector lines/arrows, freehand
  drawings, comments, and nested boards
- Boards nest infinitely; breadcrumbs + browser back/forward; Ctrl/Cmd+K fuzzy
  search across every board and card; cut/copy/paste across boards
- Export boards as PNG (2×) / PDF / JSON; full workspace backup & restore as a
  zip; everything stored locally in IndexedDB — works completely offline
- Mobile: sidebar drawer, bottom toolbar, one-finger pan, long-press drag,
  pinch zoom, quick-capture FAB (note / camera / photo library / link → current
  board or Inbox)

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run e2e        # Playwright e2e (desktop + mobile, builds + previews)
npm run build      # type-check + production build
npm run icons      # regenerate PWA icons from the SVG mark
```

## Install as an app

Mosaic is a PWA — install it once per device and it opens in its own window
and works offline.

| Platform | How |
| --- | --- |
| **Windows / macOS / Linux (Chrome, Edge)** | Open the app → click the install icon in the address bar (⊕ / monitor-with-arrow) → **Install** |
| **macOS (Safari 17+)** | File menu → **Add to Dock…** |
| **iOS / iPadOS (Safari)** | Share button → **Add to Home Screen** |
| **Android (Chrome)** | ⋮ menu → **Add to Home screen** (or the install banner) |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space + drag / middle mouse | Pan |
| Ctrl/Cmd + scroll, pinch | Zoom (10–400%) |
| Double-click canvas | New note |
| Enter | Edit selected card |
| Esc | Exit edit / cancel gesture / clear selection |
| Shift + click, marquee drag | Multi-select |
| Ctrl/Cmd + Z / + Shift + Z | Undo / redo |
| Ctrl/Cmd + D, Alt + drag | Duplicate |
| Ctrl/Cmd + C / X / V | Copy / cut / paste (works across boards) |
| Delete / Backspace | Delete selection |
| `]` / `[` (+ Shift) | Bring forward / send back (to front / to back) |
| Ctrl/Cmd + K | Search boards and cards |
| `?` | Shortcuts panel |

## Architecture

```
src/
  db/        Dexie schema (boards, elements, assets, tombstones, outbox, meta)
  store/     zustand store, command pattern (+history), persister, board ops
  canvas/    viewport math, pointer state machine, snapping, drawing, hit tests
  elements/  one folder per card type (note, title, image, link, todo, column,
             swatch, line, drawing, boardLink, comment)
  ui/        sidebar, breadcrumbs, toolbar, search palette, shortcuts panel,
             quick capture, export menu
  export/    PNG / PDF / JSON / zip backup + restore
```

- **Local-first**: IndexedDB (Dexie) is the source of truth; the UI reads a
  Zustand store mirroring it. Google Drive sync (M6) is a pure layer on top —
  disabling it changes nothing about app behavior.
- **Single mutation funnel**: every change is a command made of
  `{entity, id, before, after}` changes → store → debounced write-behind to
  Dexie (bumping `updatedAt`, writing tombstones, queueing the sync outbox).
  This one funnel powers complete undo/redo and reliable sync.
- **DOM canvas**: cards are absolutely-positioned divs inside a
  translated/scaled world container (60fps transform-only updates, rAF-batched
  pointer moves); SVG layers carry connector lines and drawings. Cards outside
  the viewport (+300px margin) aren't mounted, so 1,500-element boards stay
  smooth.

Design decisions are logged in [DECISIONS.md](DECISIONS.md).

## Privacy

No analytics, no server. Your data lives in your browser (IndexedDB) and — if
you connect it — in a visible `Mosaic` folder in your own Google Drive, using
the least-privilege `drive.file` scope (the app can only see files it created).
Access tokens are kept in memory only.
