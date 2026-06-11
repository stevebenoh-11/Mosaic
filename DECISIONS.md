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
