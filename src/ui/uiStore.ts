import { create } from 'zustand';
import type { ElementType } from '@/db/types';

interface UiState {
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
