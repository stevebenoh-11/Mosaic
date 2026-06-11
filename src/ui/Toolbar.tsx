import { useEffect } from 'react';
import {
  CheckSquare,
  Columns2,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Minus,
  Palette,
  PenLine,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import { useStore } from '@/store';
import { useUiStore } from './uiStore';
import type { ElementType } from '@/db/types';
import { buildElement } from '@/store/elementCommands';
import { screenToWorld } from '@/canvas/coords';

interface Tool {
  type: ElementType;
  label: string;
  icon: typeof StickyNote;
  enabled: boolean;
}

const TOOLS: Tool[] = [
  { type: 'note', label: 'Note', icon: StickyNote, enabled: true },
  { type: 'title', label: 'Title', icon: Type, enabled: true },
  { type: 'image', label: 'Image', icon: ImageIcon, enabled: false },
  { type: 'link', label: 'Link', icon: Link2, enabled: false },
  { type: 'todo', label: 'To-do', icon: CheckSquare, enabled: false },
  { type: 'column', label: 'Column', icon: Columns2, enabled: false },
  { type: 'swatch', label: 'Swatch', icon: Palette, enabled: true },
  { type: 'line', label: 'Line', icon: Minus, enabled: false },
  { type: 'drawing', label: 'Draw', icon: PenLine, enabled: false },
  { type: 'boardLink', label: 'Board', icon: Square, enabled: false },
  { type: 'comment', label: 'Comment', icon: MessageSquare, enabled: false },
];

/**
 * Left-edge tool palette. Tools are dragged onto the canvas (pointer events,
 * ghost preview, Esc cancels). Click also creates at the viewport center.
 */
export function Toolbar({ boardId }: { boardId: string }) {
  const draggingTool = useUiStore((s) => s.draggingTool);
  const dragPoint = useUiStore((s) => s.dragPoint);
  const setDraggingTool = useUiStore((s) => s.setDraggingTool);

  useEffect(() => {
    if (!draggingTool) return;

    function onMove(e: PointerEvent) {
      useUiStore.getState().setDraggingTool(draggingTool, {
        x: e.clientX,
        y: e.clientY,
      });
    }
    function onUp(e: PointerEvent) {
      const tool = useUiStore.getState().draggingTool;
      setDraggingTool(null);
      if (!tool) return;
      // Released back over the toolbar → treat as a click (handled by onClick).
      if (e.target instanceof HTMLElement && e.target.closest('[role="toolbar"]')) {
        return;
      }
      const canvas = document.querySelector('[data-testid="canvas"]');
      const rect = canvas?.getBoundingClientRect();
      if (
        !rect ||
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return; // dropped outside the canvas
      }
      createAt(tool, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDraggingTool(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingTool]);

  function createAt(type: ElementType, local: { x: number; y: number }) {
    const state = useStore.getState();
    const world = screenToWorld(local, state.viewport);
    const maxZ = Math.max(
      0,
      ...Object.values(state.elements)
        .filter((el) => el.boardId === boardId)
        .map((el) => el.zIndex),
    );
    const el = buildElement(boardId, type, world.x, world.y, maxZ + 1);
    state.execute({
      label: `Create ${type}`,
      changes: [{ entity: 'element', id: el.id, before: null, after: el }],
    });
    state.setSelection([el.id]);
    if (type === 'note' || type === 'title') state.setEditing(el.id);
  }

  function createAtCenter(type: ElementType) {
    const canvas = document.querySelector('[data-testid="canvas"]');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    createAt(type, { x: rect.width / 2 - 100, y: rect.height / 2 - 40 });
  }

  return (
    <>
      <div
        className="absolute left-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-0.5 rounded-xl border border-card-border bg-card p-1.5 shadow-card"
        role="toolbar"
        aria-label="Add elements"
      >
        {TOOLS.map((t) => (
          <button
            key={t.type}
            aria-label={`Add ${t.label}`}
            title={t.enabled ? t.label : `${t.label} (coming soon)`}
            disabled={!t.enabled}
            onPointerDown={(e) => {
              if (!t.enabled || e.button !== 0) return;
              e.preventDefault();
              setDraggingTool(t.type, { x: e.clientX, y: e.clientY });
            }}
            onClick={() => t.enabled && !dragPoint && createAtCenter(t.type)}
            className="rounded-lg p-2 text-ink-soft enabled:hover:bg-panel-border/60 enabled:hover:text-ink disabled:opacity-30"
          >
            <t.icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* drag ghost */}
      {draggingTool && dragPoint && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-accent/60 bg-card/90 px-3 py-2 text-xs text-ink-soft shadow-card-drag"
          style={{ left: dragPoint.x + 8, top: dragPoint.y + 8, width: 140 }}
        >
          {TOOLS.find((t) => t.type === draggingTool)?.label}
        </div>
      )}
    </>
  );
}
