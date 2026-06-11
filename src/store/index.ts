import { create } from 'zustand';
import { db, getMeta, setMeta } from '@/db/schema';
import { bootstrapDb } from '@/db/bootstrap';
import type { Board, Element } from '@/db/types';
import { invertCommand, type Change, type Command } from './commands';
import { History } from './history';
import { Persister } from './persister';

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export type SaveState = 'saved' | 'saving';

interface AppState {
  ready: boolean;
  deviceId: string;
  boards: Record<string, Board>;
  /** Elements of the currently open board (plus any recently touched by commands). */
  elements: Record<string, Element>;
  currentBoardId: string | null;
  selection: string[];
  /** Element currently in text-edit mode (note/title/todo…). */
  editingElementId: string | null;
  viewport: Viewport;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;

  init(): Promise<void>;
  openBoard(boardId: string): Promise<void>;
  execute(cmd: Command): void;
  undo(): void;
  redo(): void;
  /** End the current text-editing session so further edits are a new undo step. */
  breakCoalescing(): void;
  /** Force-flush pending writes (used on tab hide/unload). */
  flushNow(): Promise<void>;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  setViewport(v: Viewport): void;
  /**
   * Transient updates during drag/resize previews: bypasses history and
   * persistence. The interaction commits a real command on completion.
   */
  updateEphemeral(patches: Record<string, Partial<Element>>): void;
}

export const history = new History();

export const useStore = create<AppState>((set, get) => {
  const persister = new Persister(
    (entity, id) =>
      entity === 'board' ? get().boards[id] : get().elements[id],
    (saveState) => set({ saveState }),
  );

  let viewportSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function applyChanges(changes: Change[]): void {
    const now = Date.now();
    const boards = { ...get().boards };
    const elements = { ...get().elements };

    for (const c of changes) {
      if (c.entity === 'board') {
        if (c.after) boards[c.id] = { ...c.after, updatedAt: now };
        else delete boards[c.id];
      } else {
        if (c.after) elements[c.id] = { ...c.after, updatedAt: now };
        else delete elements[c.id];
      }
      const boardId =
        c.entity === 'element'
          ? ((c.after ?? c.before)?.boardId ?? null)
          : null;
      persister.markDirty(c.entity, c.id, boardId);
    }
    set({ boards, elements });
  }

  function syncHistoryFlags(): void {
    set({ canUndo: history.canUndo, canRedo: history.canRedo });
  }

  return {
    ready: false,
    deviceId: '',
    boards: {},
    elements: {},
    currentBoardId: null,
    selection: [],
    editingElementId: null,
    viewport: DEFAULT_VIEWPORT,
    saveState: 'saved',
    canUndo: false,
    canRedo: false,

    async init() {
      const { deviceId } = await bootstrapDb();
      const boardRows = await db.boards.toArray();
      const boards: Record<string, Board> = {};
      for (const b of boardRows) boards[b.id] = b;
      set({ deviceId, boards, ready: true });
    },

    async openBoard(boardId) {
      await persister.flush();
      const rows = await db.elements.where('boardId').equals(boardId).toArray();
      const elements: Record<string, Element> = {};
      for (const e of rows) elements[e.id] = e;
      const viewport =
        (await getMeta<Viewport>(`viewport:${boardId}`)) ?? DEFAULT_VIEWPORT;
      set({
        currentBoardId: boardId,
        elements,
        selection: [],
        editingElementId: null,
        viewport,
      });
      // Track recent boards (most recent first, capped).
      const recents = (await getMeta<string[]>('recentBoards')) ?? [];
      const next = [boardId, ...recents.filter((id) => id !== boardId)].slice(0, 8);
      await setMeta('recentBoards', next);
    },

    execute(cmd) {
      applyChanges(cmd.changes);
      history.record(cmd);
      syncHistoryFlags();
    },

    undo() {
      const cmd = history.popUndo();
      if (cmd) {
        applyChanges(invertCommand(cmd).changes);
        // External state change would fight an open editor — close it.
        set({ editingElementId: null });
      }
      syncHistoryFlags();
    },

    redo() {
      const cmd = history.popRedo();
      if (cmd) {
        applyChanges(cmd.changes);
        set({ editingElementId: null });
      }
      syncHistoryFlags();
    },

    breakCoalescing() {
      history.breakCoalescing();
    },

    flushNow() {
      return persister.flush();
    },

    setSelection(ids) {
      set({ selection: ids });
    },

    setEditing(id) {
      if (id === null) history.breakCoalescing();
      set({ editingElementId: id });
    },

    updateEphemeral(patches) {
      const elements = { ...get().elements };
      for (const [id, patch] of Object.entries(patches)) {
        const e = elements[id];
        if (e) elements[id] = { ...e, ...patch };
      }
      set({ elements });
    },

    setViewport(v) {
      set({ viewport: v });
      const boardId = get().currentBoardId;
      if (!boardId) return;
      if (viewportSaveTimer) clearTimeout(viewportSaveTimer);
      viewportSaveTimer = setTimeout(() => {
        void setMeta(`viewport:${boardId}`, v);
      }, 500);
    },
  };
});
