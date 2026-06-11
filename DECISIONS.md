# Decisions log

Unspecified details, resolved with the simplest option consistent with the data model.

## M0

- **Command shape**: a command is a labeled list of generic entity changes
  `{ entity, id, before, after }`. Apply writes `after`; invert swaps the pair and
  reverses change order. One shape powers undo/redo, Dexie persistence, tombstones
  and outbox dirty-tracking — no per-command apply/invert code to keep in sync.
- **`updatedAt` bumping** happens at change-apply time (including undo/redo), so a
  later undo is "newer" than the edit it reverts — required for last-write-wins sync.
- **Persistence**: in-memory Zustand state is the live truth; a 300 ms debounced
  write-behind flushes dirty entities to Dexie. `openBoard` flushes first, so
  navigation never races the debounce.
- **Outbox dedup**: one pending outbox row per entity (keyed `entityType+entityId`),
  re-queued with the latest `queuedAt` on every change. Sync only needs to know
  *that* an entity is dirty, not each intermediate state.
- **Viewport per board** persisted in `meta` under `viewport:<boardId>` (debounced
  500 ms); not synced, since pan/zoom is device-local ergonomics, not content.
- **Vitest 3** instead of 2.x: vitest 2 pins vite 5 internally and its config types
  clash with vite 6.
- **History cap**: 200 undo steps.
- **Icons**: generated from the SVG mark via `scripts/generate-icons.mjs` (sharp);
  committed under `public/icons` so builds don't depend on the script.

## M1

- **Drag/resize previews** mutate store state directly (`updateEphemeral`, no
  history/persistence); the gesture commits one command from start-snapshot to
  final geometry on pointer-up. Esc restores the snapshot.
- **Text undo**: TipTap's own history is disabled. Each editing session's
  keystrokes (debounced 300 ms) execute commands with a per-element coalesce key,
  so one session = one undo step in the app-wide history. Undo/redo while editing
  closes the editor first (external doc changes would fight ProseMirror state).
- **Alt-drag duplicate** = duplicate-in-place command + move command sharing one
  coalesce key → a single undo step that creates the copies at their final spot.
- **Auto-height cards** (note, title): `h` is presentation-derived. A
  ResizeObserver syncs the rendered height into the store ephemerally so
  marquee/snap use true bounds; it is persisted only as a side effect of other
  commands. Notes/titles expose only east/west resize handles.
- **Mouse wheel** without ctrl pans (matches trackpad two-finger); ctrl/cmd+wheel
  zooms at the cursor; two-pointer pinch zooms. Zoom clamped 10–400%.
- **Z-order**: `]`/`[` swap z with the nearest overlapping-direction neighbor;
  Shift jumps to front/back. New elements always get maxZ+1.
- **Click-to-create**: clicking a toolbar tool (without dragging) creates the
  element at the viewport center — discoverability beats strict drag-only.

## M2

- **Pointer capture on the element, not the canvas**: capturing on the container
  retargets derived click/dblclick events to it, silently breaking
  double-click-to-edit on cards. Element-level capture keeps drags smooth and
  lets dblclick reach the card.
- **Column children** keep their last canvas `x/y` while stacked (unused but
  restored context), and `sortIndex` uses fractional insertion (midpoint between
  neighbors) for canvas→column drops; dnd-kit reorders renumber 0..n.
- **Two drag systems, one boundary**: canvas cards move via the custom pointer
  machine (with live column insertion indicator on hover); cards *inside*
  columns are dnd-kit sortables, and dropping one on the canvas droppable pops
  it back out at the drag position. Collision priority: child card → column →
  canvas.
- **Deleting a column deletes its cards**; deleting any card cascade-deletes
  lines connected to it and comments pinned to it — all in one undoable command.
- **No favicon fetching**: public favicon endpoints are CORS-blocked for
  programmatic reads; link cards show a generic globe icon. Page metadata is
  still attempted directly (works for CORS-permissive sites, falls back to
  domain + URL).
- **Comments** may carry `targetElementId`/`offsetX/Y` in content so pins follow
  the card they were dropped on. Pins are not draggable in v1; they are placed
  at creation and deleted/resolved from the popover. Lines and comments are not
  part of marquee selection.
- **Line creation** drags from edge anchors shown on the selected card; the
  toolbar Line tool drops a free point-to-point arrow. Endpoint sides resolve
  dynamically (nearest side) unless pinned by the anchor used.
- **Duplicating a column** copies the column card only, not its children.

## M3

- **Board tool** creates the child board *and* its boardLink card in one
  command, so undo removes both. Board cards navigate on double-click — handled
  on the ElementView wrapper because pointer capture retargets dblclick there.
- **Deleting a board** loads its elements from Dexie (they're rarely in memory),
  tombstones them with the board, and re-parents sub-boards to the deleted
  board's parent — one undoable command. boardLink cards pointing at a missing
  board render a "Missing board" card rather than breaking.
- **Cut/copy/paste** uses an in-memory app clipboard (lost on reload — system
  clipboard can't round-trip arbitrary card graphs). Internal clipboard takes
  precedence over system paste on Ctrl+V; system text/image paste applies when
  the app clipboard is empty. Clones remap ids for column membership, line
  endpoints, and comment targets; lines whose endpoints fall outside the copied
  set are skipped.
- **Cross-board moves** keep coordinates; pinned comments follow; lines move
  only when both endpoints move, otherwise they're deleted in the same command.
- **Sidebar drag**: top/bottom 30% of a row = reorder before/after, middle =
  nest inside; dropping onto your own descendant is refused (cycle guard).
- **Search palette** indexes Dexie directly on open (boards + all element text),
  so it spans unloaded boards; simple token-substring scoring, boards ranked
  slightly above elements; empty query = recent boards (meta `recentBoards`,
  cap 8). Selecting an element result navigates, selects, centers and flashes.
- **Flush-on-hide**: pending debounced writes are force-flushed on
  `visibilitychange: hidden` / `pagehide` / `beforeunload`.

## M4

- **Drawing sessions**: one `drawing` element per draw-mode session — the first
  stroke creates it, later strokes union its bounds (shifting stored
  element-local points). Each stroke is its own undo step; eraser removals
  coalesce per gesture. Strokes are RDP-simplified (tolerance 0.8 world px).
  Drawings drag but don't resize in v1; eraser removes whole strokes.
- **PNG/PDF export** captures the live world DOM via html-to-image with the
  transform overridden to content bounds at scale 1, pixelRatio 2; PDF embeds
  that PNG at 96 dpi → pt. Selection is cleared before capture.
- **Backup restore REPLACES** the workspace (after an explicit confirm) and
  marks everything restored as dirty in the outbox so a later sync push is
  complete. Tombstones are cleared on restore.

## M5

- **Touch model**: touch on empty canvas always pans (marquee is mouse-only;
  multi-select on touch via tap + future lasso is out of v1 scope). Touch on a
  card selects immediately; dragging unlocks after a 300 ms long-press
  (vibration cue) — early movement converts the gesture to a canvas pan.
- **Virtualization** filters at render: cards intersecting viewport +300 px
  margin, plus anything selected/editing. Lines/comments always render (cheap
  SVG/small pins). Stress: 1,500-element board mounts <500 DOM cards.
- **Quick capture** targets the current board or a pinned "Inbox" root board
  (created on first use, sortIndex -1, id cached in meta). Captures to other
  boards stack below that board's existing content.
- **Image cards clamp to a minimum 80×60 display size** so tiny images stay
  grabbable.
- **e2e** runs against a production build (`vite preview`) so the service
  worker and offline cold-start are exercised for real; each test is
  self-contained because Playwright contexts have isolated IndexedDB.

## M6

- **Tie-breaking**: rows carry `modifiedBy` (deviceId) stamped by the persister;
  tombstones carry `deletedBy` + `boardId`. LWW compares timestamps, then
  "delete beats edit" on exact ties, then higher deviceId — fully deterministic
  on both sides (`sync/merge.ts` is pure and unit-tested).
- **Engine is store-agnostic**: it talks to Dexie + a `RemoteStore` interface
  and reports via callbacks; the app glue (`sync/index.ts`) refreshes zustand
  (skipping any element mid-edit) and flushes the persister before each cycle.
  Tests run two engines against an in-memory FakeRemote with revision counters.
- **Push** is read-merge-write per board file: if the remote `headRevisionId`
  moved since last seen, merge first, then upload; outbox rows are cleared only
  up to the sequence snapshot taken at cycle start. The brief Drive-level race
  is accepted — element-level LWW self-heals on the next cycle.
- **First connect** enqueues the entire local workspace; the normal
  pull-then-push cycle yields an element-by-element merge with any existing
  remote data. "Replace" is never offered.
- **Board deletion** travels via `deleted: true` manifest entries; the stale
  board file is left in Drive (harmless, cheap) rather than deleted.
- **Moved elements**: merging a board file checks remote ids against the whole
  local elements table, so a card moved to another board locally can't be
  resurrected by a stale copy in its old board's file.
- **Outbox→engine signal** is a window CustomEvent fired after each persister
  flush (push debounce ~4s); pulls happen on focus, online, every 30s while
  visible, and via Sync now.
- **Menus close via capture-phase pointerdown** — canvas cards stopPropagation
  on bubble, which silently kept dropdown menus open (found by the sync e2e).
- **Mocked e2e**: `accounts.google.com/gsi/client` is fulfilled with a stub
  token client and `www.googleapis.com/**` with an in-memory MiniDrive shared
  across two browser contexts (= two devices), run against the production
  build with a dummy client ID baked in.
