import { create } from 'zustand';
import type { Element, ElementType } from '@/db/types';

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  /** Internal clipboard for cut/copy/paste of elements (cross-board). */
  clipboard: Element[] | null;
  setClipboard(els: Element[] | null): void;
  /** Element to flash-highlight + center after search navigation. */
  flashElementId: string | null;
  setFlashElementId(id: string | null): void;
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;
  /** Tool being dragged from the toolbar (ghost preview follows pointer). */
  draggingTool: ElementType | null;
  dragPoint: { x: number; y: number } | null;
  setDraggingTool(tool: ElementType | null, point?: { x: number; y: number }): void;
  /** Live insertion target while dragging cards over a column. */
  columnDropTarget: { columnId: string; index: number } | null;
  setColumnDropTarget(t: { columnId: string; index: number } | null): void;
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
  flashElementId: null,
  setFlashElementId: (flashElementId) => set({ flashElementId }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  draggingTool: null,
  dragPoint: null,
  setDraggingTool: (draggingTool, dragPoint) =>
    set({ draggingTool, dragPoint: draggingTool ? (dragPoint ?? null) : null }),
  columnDropTarget: null,
  setColumnDropTarget: (columnDropTarget) => set({ columnDropTarget }),
}));

/** True when the event originates from a text-input context. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
