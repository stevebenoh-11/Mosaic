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
