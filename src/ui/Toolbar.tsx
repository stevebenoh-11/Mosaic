import { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  Columns2,
  FileText,
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
import type { Element, ElementType } from '@/db/types';
import { buildElement } from '@/store/elementCommands';
import { newId as newBoardId } from '@/db/ids';
import { screenToWorld } from '@/canvas/coords';
import { topElementAt } from '@/canvas/hitTest';
import { createImageElement, createLinkElement, normalizeUrl } from '@/elements/createFromMedia';

interface Tool {
  type: ElementType;
  label: string;
  icon: typeof StickyNote;
  enabled: boolean;
  hint?: string;
}

const TOOLS: Tool[] = [
  { type: 'note', label: 'Note', icon: StickyNote, enabled: true },
  { type: 'document', label: 'Document', icon: FileText, enabled: true },
  { type: 'title', label: 'Heading', icon: Type, enabled: true },
  { type: 'image', label: 'Image', icon: ImageIcon, enabled: true },
  { type: 'link', label: 'Link', icon: Link2, enabled: true },
  { type: 'todo', label: 'To-do', icon: CheckSquare, enabled: true },
  { type: 'column', label: 'Column', icon: Columns2, enabled: true },
  { type: 'swatch', label: 'Color', icon: Palette, enabled: true },
  { type: 'line', label: 'Line', icon: Minus, enabled: true, hint: 'Tip: drag from a selected card’s edge dots' },
  { type: 'drawing', label: 'Draw', icon: PenLine, enabled: true, hint: 'Draw freehand on the canvas' },
  { type: 'boardLink', label: 'Board', icon: Square, enabled: true },
  { type: 'comment', label: 'Comment', icon: MessageSquare, enabled: true },
];

/**
 * Left-edge tool palette. Tools are dragged onto the canvas (pointer events,
 * ghost preview, Esc cancels). Click also creates at the viewport center.
 */
export function Toolbar({ boardId }: { boardId: string }) {
  const draggingTool = useUiStore((s) => s.draggingTool);
  const dragPoint = useUiStore((s) => s.dragPoint);
  const setDraggingTool = useUiStore((s) => s.setDraggingTool);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImageWorld, setPendingImageWorld] = useState<{ x: number; y: number } | null>(null);

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
      if (e.target instanceof Element && e.target.closest('[role="toolbar"]')) {
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

    if (type === 'image') {
      setPendingImageWorld(world);
      fileInputRef.current?.click();
      return;
    }
    if (type === 'link') {
      const input = window.prompt('Link URL', 'https://');
      if (input === null) return;
      const url = normalizeUrl(input);
      if (url) createLinkElement(boardId, url, world);
      else if (input.trim()) window.alert('That doesn’t look like a valid web link.');
      return;
    }
    if (type === 'boardLink') {
      // One command: new child board + its card on this board.
      const now = Date.now();
      const siblingCount = Object.values(state.boards).filter(
        (b) => b.parentBoardId === boardId,
      ).length;
      const board = {
        id: newBoardId(),
        title: 'Untitled board',
        parentBoardId: boardId,
        sortIndex: siblingCount,
        createdAt: now,
        updatedAt: now,
      };
      const el = buildElement(boardId, 'boardLink', world.x, world.y, maxZ + 1, {
        content: { boardId: board.id },
      });
      state.execute({
        label: 'Create board',
        changes: [
          { entity: 'board', id: board.id, before: null, after: board },
          { entity: 'element', id: el.id, before: null, after: el },
        ],
      });
      state.setSelection([el.id]);
      return;
    }

    let overrides: Partial<Element> = {};
    if (type === 'comment') {
      const target = topElementAt(state.elements, boardId, world);
      overrides = {
        content: {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
          authorName: 'You',
          resolved: false,
          ...(target
            ? {
                targetElementId: target.id,
                offsetX: world.x - target.x,
                offsetY: world.y - target.y,
              }
            : {}),
        } as Element['content'],
      };
    } else if (type === 'line') {
      overrides = {
        w: 0,
        h: 0,
        content: {
          from: { point: { x: world.x - 80, y: world.y } },
          to: { point: { x: world.x + 80, y: world.y } },
          curve: false,
          dashed: false,
          arrowEnd: true,
        },
      };
    }

    const el = buildElement(boardId, type, world.x, world.y, maxZ + 1, overrides);
    state.execute({
      label: `Create ${type}`,
      changes: [{ entity: 'element', id: el.id, before: null, after: el }],
    });
    state.setSelection([el.id]);
    if (type === 'note' || type === 'title' || type === 'column') {
      state.setEditing(el.id);
    }
    if (type === 'document') {
      // Open the expanded editor so the user can start writing immediately.
      useUiStore.getState().setOpenDocumentId(el.id);
    }
    if (type === 'comment') {
      // Open the new comment so the user can type immediately.
      useUiStore.getState().setPendingCommentOpen(el.id);
    }
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
        className="absolute inset-x-2 bottom-2 z-40 flex flex-row justify-start gap-0.5 overflow-x-auto rounded-xl border border-card-border bg-card p-1.5 shadow-card sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-1/2 sm:-translate-y-1/2 sm:flex-col sm:overflow-visible"
        role="toolbar"
        aria-label="Add elements"
      >
        {TOOLS.map((t) => (
          <button
            key={t.type}
            aria-label={`Add ${t.label}`}
            title={t.enabled ? (t.hint ?? t.label) : `${t.label} (coming soon)`}
            disabled={!t.enabled}
            onPointerDown={(e) => {
              if (!t.enabled || e.button !== 0 || t.type === 'drawing') return;
              e.preventDefault();
              setDraggingTool(t.type, { x: e.clientX, y: e.clientY });
            }}
            onClick={() => {
              if (!t.enabled) return;
              if (t.type === 'drawing') {
                const ui = useUiStore.getState();
                ui.setDrawMode({
                  active: !ui.drawMode.active,
                  eraser: false,
                  activeDrawingId: null,
                });
                return;
              }
              if (!dragPoint) createAtCenter(t.type);
            }}
            className="rounded-lg p-2 text-ink-soft enabled:hover:bg-panel-border/60 enabled:hover:text-ink disabled:opacity-30"
          >
            <t.icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* hidden file input for the Image tool */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label="Upload image"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          const base = pendingImageWorld ?? { x: 200, y: 200 };
          void (async () => {
            for (const [i, f] of files.entries()) {
              try {
                await createImageElement(boardId, f, f.name, {
                  x: base.x + i * 24,
                  y: base.y + i * 24,
                });
              } catch (err) {
                window.alert(
                  err instanceof Error ? err.message : 'Could not add image.',
                );
                break;
              }
            }
          })();
          e.target.value = '';
          setPendingImageWorld(null);
        }}
      />

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
