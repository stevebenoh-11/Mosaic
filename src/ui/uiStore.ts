import { create } from 'zustand';
import type { Element, ElementType } from '@/db/types';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'mosaic:theme';

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* localStorage blocked (private mode) — fall through to system preference */
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/** Reflect the theme onto <html> so the CSS variable overrides take effect. */
export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}

interface UiState {
  theme: Theme;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  /** Mobile drawer state for the board sidebar. */
  sidebarOpen: boolean;
  setSidebarOpen(open: boolean): void;
  /** Internal clipboard for cut/copy/paste of elements (cross-board). */
  clipboard: Element[] | null;
  setClipboard(els: Element[] | null): void;
  /** Element to flash-highlight + center after search navigation. */
  flashElementId: string | null;
  setFlashElementId(id: string | null): void;
  /** A freshly-created comment to open for editing (consumed by the canvas). */
  pendingCommentOpen: string | null;
  setPendingCommentOpen(id: string | null): void;
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;
  /** Tool being dragged from the toolbar (ghost preview follows pointer). */
  draggingTool: ElementType | null;
  dragPoint: { x: number; y: number } | null;
  setDraggingTool(tool: ElementType | null, point?: { x: number; y: number }): void;
  /** Live insertion target while dragging cards over a column. */
  columnDropTarget: { columnId: string; index: number } | null;
  setColumnDropTarget(t: { columnId: string; index: number } | null): void;
  /** Freehand drawing mode. */
  drawMode: {
    active: boolean;
    color: string;
    width: number;
    eraser: boolean;
    /** Drawing element being extended this session. */
    activeDrawingId: string | null;
  };
  setDrawMode(patch: Partial<UiState['drawMode']>): void;
}

function persistTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore: theme just won't persist across reloads */
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    persistTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    persistTheme(theme);
    set({ theme });
  },
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
  flashElementId: null,
  setFlashElementId: (flashElementId) => set({ flashElementId }),
  pendingCommentOpen: null,
  setPendingCommentOpen: (pendingCommentOpen) => set({ pendingCommentOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  draggingTool: null,
  dragPoint: null,
  setDraggingTool: (draggingTool, dragPoint) =>
    set({ draggingTool, dragPoint: draggingTool ? (dragPoint ?? null) : null }),
  columnDropTarget: null,
  setColumnDropTarget: (columnDropTarget) => set({ columnDropTarget }),
  drawMode: {
    active: false,
    color: '#2D2A26',
    width: 3,
    eraser: false,
    activeDrawingId: null,
  },
  setDrawMode: (patch) =>
    set((s) => ({ drawMode: { ...s.drawMode, ...patch } })),
}));

/** True when the event originates from a text-input context. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
