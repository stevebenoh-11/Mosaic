import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import { useUiStore, isTypingTarget } from '@/ui/uiStore';
import type { Element, LineContent, LineEndpoint } from '@/db/types';
import {
  buildElement,
  deleteElementsCmd,
  duplicateElementsCmd,
  updateElementsCmd,
  zOrderCmd,
} from '@/store/elementCommands';
import { ElementView, AUTO_HEIGHT } from '@/elements/ElementView';
import { ElementBody, COLUMNABLE } from '@/elements/ElementBody';
import { columnChildren } from '@/elements/column/ColumnCard';
import { LineLayer } from '@/elements/line/LineLayer';
import { anchorPoint, linePath, type ResolvedEnd, type Side } from '@/elements/line/geometry';
import { CommentPin } from '@/elements/comment/CommentPin';
import { createImageElement, createLinkElement, URL_RE } from '@/elements/createFromMedia';
import { cloneElements, moveElementsToBoardCmd } from '@/store/boardCommands';
import {
  boundingBox,
  clampScale,
  elementRect,
  rectsIntersect,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Point,
  type Rect,
} from './coords';
import { topElementAt } from './hitTest';
import { computeSnap, type SnapGuide } from './snapping';
import { distanceToPath, simplifyPoints, strokeBounds } from './drawing';
import { ZoomControls } from './ZoomControls';
import { DrawBar } from '@/ui/DrawBar';
import type { DrawingContent } from '@/db/types';

const DRAG_THRESHOLD_PX = 4;
const SNAP_THRESHOLD_PX = 8;
const GRID_SPACING = 24;
const MIN_W = 60;
const MIN_H = 40;

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Interaction =
  | { kind: 'idle' }
  | { kind: 'pan'; start: Point; startViewport: { x: number; y: number; scale: number } }
  | {
      kind: 'marquee';
      startWorld: Point;
      additive: boolean;
      prevSelection: string[];
      moved: boolean;
    }
  | {
      kind: 'drag';
      ids: string[];
      snapshots: Map<string, Element>;
      startWorld: Point;
      startClient: Point;
      moved: boolean;
      alt: boolean;
      duplicated: boolean;
      coalesceKey?: string;
      soloCandidate: string | null;
      toggleCandidate: string | null;
      /** Touch: drag only unlocks after a long-press; early move = pan. */
      touchPending: boolean;
      longPressTimer: number | null;
    }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      snapshot: Element;
      startWorld: Point;
    }
  | { kind: 'line-draw'; fromId: string; fromSide: Side; moved: boolean }
  | {
      kind: 'line-endpoint';
      lineId: string;
      end: 'from' | 'to';
      snapshot: Element;
      moved: boolean;
    }
  | { kind: 'draw'; points: number[] }
  | { kind: 'erase'; gesture: string }
  | { kind: 'pinch' };

/** Expand a deletion set with lines/comments that reference the victims. */
function withDependents(
  elements: Record<string, Element>,
  boardId: string,
  targets: Element[],
): Element[] {
  const ids = new Set(targets.map((e) => e.id));
  const all = [...targets];
  // Column children go with their column.
  for (const el of Object.values(elements)) {
    if (el.boardId !== boardId || ids.has(el.id)) continue;
    if (el.parentColumnId && ids.has(el.parentColumnId)) {
      ids.add(el.id);
      all.push(el);
    }
  }
  for (const el of Object.values(elements)) {
    if (el.boardId !== boardId || ids.has(el.id)) continue;
    if (el.type === 'line') {
      const c = el.content as LineContent;
      const refs = [c.from, c.to].some(
        (end) => 'elementId' in end && ids.has(end.elementId),
      );
      if (refs) {
        ids.add(el.id);
        all.push(el);
      }
    } else if (el.type === 'comment') {
      const c = el.content as { targetElementId?: string };
      if (c.targetElementId && ids.has(c.targetElementId)) {
        ids.add(el.id);
        all.push(el);
      }
    }
  }
  return all;
}

export function CanvasView({ boardId }: { boardId: string }) {
  const elements = useStore((s) => s.elements);
  const viewport = useStore((s) => s.viewport);
  const selection = useStore((s) => s.selection);
  const editingElementId = useStore((s) => s.editingElementId);
  const setSelection = useStore((s) => s.setSelection);
  const setEditing = useStore((s) => s.setEditing);
  const setViewport = useStore((s) => s.setViewport);
  const updateEphemeral = useStore((s) => s.updateEphemeral);
  const execute = useStore((s) => s.execute);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setColumnDropTarget = useUiStore((s) => s.setColumnDropTarget);

  const containerRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction>({ kind: 'idle' });
  const pointersRef = useRef(new Map<number, Point>());
  const pinchBaseRef = useRef<{ dist: number; viewport: typeof viewport } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<Point | null>(null);

  const [spaceDown, setSpaceDown] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [tempLine, setTempLine] = useState<{ d: string } | null>(null);
  const [tempStroke, setTempStroke] = useState<{
    points: number[];
    color: string;
    width: number;
  } | null>(null);
  const drawActive = useUiStore((s) => s.drawMode.active);
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [dndActiveId, setDndActiveId] = useState<string | null>(null);

  const boardElements = useMemo(
    () =>
      Object.values(elements).filter(
        (e) => e.boardId === boardId && e.parentColumnId === null,
      ),
    [elements, boardId],
  );
  const cardElements = useMemo(
    () => boardElements.filter((e) => e.type !== 'line' && e.type !== 'comment'),
    [boardElements],
  );
  const lineElements = useMemo(
    () => boardElements.filter((e) => e.type === 'line'),
    [boardElements],
  );
  const commentElements = useMemo(
    () => boardElements.filter((e) => e.type === 'comment'),
    [boardElements],
  );

  const maxZ = useMemo(
    () => Math.max(0, ...boardElements.map((e) => e.zIndex)),
    [boardElements],
  );

  const selectedElements = useMemo(
    () => selection.map((id) => elements[id]).filter((e): e is Element => !!e),
    [selection, elements],
  );

  // ----- coordinate helpers -----

  const toLocal = useCallback((client: Point): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: client.x - rect.left, y: client.y - rect.top } : client;
  }, []);

  const toWorld = useCallback(
    (client: Point): Point =>
      screenToWorld(toLocal(client), useStore.getState().viewport),
    [toLocal],
  );

  // ----- container size (for virtualization + fit) -----

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setContainerSize({ w: node.clientWidth, h: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ----- wheel: zoom (ctrl/cmd) or pan -----

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const v = useStore.getState().viewport;
      if (e.ctrlKey || e.metaKey) {
        const local = toLocal({ x: e.clientX, y: e.clientY });
        const factor = Math.exp(-e.deltaY * 0.01);
        setViewport(zoomAt(v, local, v.scale * factor));
      } else {
        setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [setViewport, toLocal]);

  // ----- paste & OS file drop -----

  useEffect(() => {
    function centerWorld(): Point {
      const rect = containerRef.current?.getBoundingClientRect();
      const local = rect
        ? { x: rect.width / 2 - 120, y: rect.height / 2 - 60 }
        : { x: 300, y: 200 };
      return screenToWorld(local, useStore.getState().viewport);
    }
    function onPaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target) || useStore.getState().editingElementId) return;
      const files = [...(e.clipboardData?.files ?? [])];
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length > 0) {
        e.preventDefault();
        const base = centerWorld();
        void (async () => {
          for (const [i, f] of images.entries()) {
            try {
              await createImageElement(boardId, f, f.name || 'pasted-image', {
                x: base.x + i * 24,
                y: base.y + i * 24,
              });
            } catch (err) {
              console.error('Image paste failed:', err);
              window.alert(
                err instanceof Error ? err.message : 'Could not add image.',
              );
              break;
            }
          }
        })();
        return;
      }
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      e.preventDefault();
      if (URL_RE.test(text)) {
        createLinkElement(boardId, text, centerWorld());
      } else {
        const state = useStore.getState();
        const doc = {
          type: 'doc' as const,
          content: text.split(/\n+/).map((line) => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : undefined,
          })),
        };
        const world = centerWorld();
        const el = buildElement(boardId, 'note', world.x, world.y, maxZ + 1, {
          content: { doc },
        });
        state.execute({
          label: 'Paste note',
          changes: [{ entity: 'element', id: el.id, before: null, after: el }],
        });
        state.setSelection([el.id]);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [boardId, maxZ]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const world = toWorld({ x: e.clientX, y: e.clientY });
      const files = [...e.dataTransfer.files].filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length > 0) {
        void (async () => {
          for (const [i, f] of files.entries()) {
            try {
              await createImageElement(boardId, f, f.name, {
                x: world.x + i * 24,
                y: world.y + i * 24,
              });
            } catch (err) {
              console.error('Image drop failed:', err);
              window.alert(
                err instanceof Error ? err.message : 'Could not add image.',
              );
              break;
            }
          }
        })();
        return;
      }
      const uri = e.dataTransfer.getData('text/uri-list') ||
        e.dataTransfer.getData('text/plain');
      if (uri && URL_RE.test(uri.trim())) {
        createLinkElement(boardId, uri.trim(), world);
      }
    },
    [boardId, toWorld],
  );

  // ----- keyboard -----

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const state = useStore.getState();

      if (e.key === 'Escape') {
        const interaction = interactionRef.current;
        if (interaction.kind === 'draw' || interaction.kind === 'erase') {
          interactionRef.current = { kind: 'idle' };
          setTempStroke(null);
          return;
        }
        if (useUiStore.getState().drawMode.active) {
          useUiStore.getState().setDrawMode({ active: false, eraser: false, activeDrawingId: null });
          return;
        }
        if (interaction.kind === 'drag' || interaction.kind === 'resize') {
          const patches: Record<string, Partial<Element>> = {};
          if (interaction.kind === 'drag') {
            for (const [id, snap] of interaction.snapshots) {
              patches[id] = { x: snap.x, y: snap.y };
            }
          } else {
            const s = interaction.snapshot;
            patches[s.id] = { x: s.x, y: s.y, w: s.w, h: s.h };
          }
          updateEphemeral(patches);
          interactionRef.current = { kind: 'idle' };
          setGuides([]);
          setColumnDropTarget(null);
          return;
        }
        if (interaction.kind === 'line-draw') {
          interactionRef.current = { kind: 'idle' };
          setTempLine(null);
          return;
        }
        if (interaction.kind === 'line-endpoint') {
          // Restore the endpoint to where the drag started.
          updateEphemeral({ [interaction.lineId]: { content: interaction.snapshot.content } });
          interactionRef.current = { kind: 'idle' };
          return;
        }
        if (interaction.kind === 'marquee') {
          interactionRef.current = { kind: 'idle' };
          setMarqueeRect(null);
          setSelection(interaction.prevSelection);
          return;
        }
        if (useUiStore.getState().shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (openCommentId) {
          setOpenCommentId(null);
          return;
        }
        if (state.editingElementId) {
          setEditing(null);
          return;
        }
        if (state.selection.length > 0) setSelection([]);
        return;
      }

      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }

      if (isTypingTarget(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        const selected = state.selection
          .map((id) => state.elements[id])
          .filter((el): el is Element => !!el && el.type !== 'line');
        if (selected.length > 0) {
          const { command, newIds } = duplicateElementsCmd(selected, 16);
          execute(command);
          setSelection(newIds);
        }
        return;
      }
      if (mod && (key === 'c' || key === 'x') && state.selection.length > 0) {
        const selected = state.selection
          .map((id) => state.elements[id])
          .filter((el): el is Element => !!el);
        const full = withDependents(state.elements, boardId, selected);
        useUiStore.getState().setClipboard(full.map((el) => structuredClone(el)));
        if (key === 'x') {
          e.preventDefault();
          execute(deleteElementsCmd(full));
          setSelection([]);
        }
        return;
      }
      if (mod && key === 'v') {
        const clip = useUiStore.getState().clipboard;
        if (clip && clip.length > 0) {
          e.preventDefault(); // suppress the system paste event
          const z =
            Math.max(
              0,
              ...Object.values(state.elements)
                .filter((el) => el.boardId === boardId)
                .map((el) => el.zIndex),
            ) + 1;
          const copies = cloneElements(clip, boardId, { x: 24, y: 24 }, z);
          execute({
            label: `Paste ${copies.length > 1 ? `${copies.length} elements` : 'element'}`,
            changes: copies.map((c) => ({
              entity: 'element' as const,
              id: c.id,
              before: null,
              after: c,
            })),
          });
          setSelection(copies.filter((c) => c.parentColumnId === null).map((c) => c.id));
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.length > 0) {
        e.preventDefault();
        const selected = state.selection
          .map((id) => state.elements[id])
          .filter((el): el is Element => !!el);
        execute(deleteElementsCmd(withDependents(state.elements, boardId, selected)));
        setSelection([]);
        return;
      }
      if ((e.key === ']' || e.key === '[') && state.selection.length > 0) {
        e.preventDefault();
        const selected = state.selection
          .map((id) => state.elements[id])
          .filter((el): el is Element => !!el);
        const siblings = Object.values(state.elements).filter(
          (el) => el.boardId === boardId && el.parentColumnId === null,
        );
        const dir =
          e.key === ']'
            ? e.shiftKey
              ? 'front'
              : 'forward'
            : e.shiftKey
              ? 'back'
              : 'backward';
        const cmd = zOrderCmd(selected, siblings, dir);
        if (cmd) execute(cmd);
        return;
      }
      if (e.key === 'Enter' && state.selection.length === 1 && !state.editingElementId) {
        const el = state.elements[state.selection[0]!];
        if (el && ['note', 'title', 'swatch', 'column'].includes(el.type)) {
          e.preventDefault();
          setEditing(el.id);
        }
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(!useUiStore.getState().shortcutsOpen);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpaceDown(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [boardId, execute, openCommentId, redo, setColumnDropTarget, setEditing, setSelection, setShortcutsOpen, undo, updateEphemeral]);

  // ----- column drop target (canvas drag → column) -----

  const findColumnDrop = useCallback(
    (
      client: Point,
      draggedIds: Set<string>,
    ): { columnId: string; index: number } | null => {
      const state = useStore.getState();
      const world = screenToWorld(toLocal(client), state.viewport);
      let col: Element | null = null;
      for (const el of Object.values(state.elements)) {
        if (
          el.boardId !== boardId ||
          el.type !== 'column' ||
          el.parentColumnId !== null ||
          draggedIds.has(el.id)
        )
          continue;
        if (
          world.x >= el.x &&
          world.x <= el.x + el.w &&
          world.y >= el.y &&
          world.y <= el.y + el.h
        ) {
          if (!col || el.zIndex > col.zIndex) col = el;
        }
      }
      if (!col) return null;
      const node = document.querySelector(`[data-column-id="${col.id}"]`);
      if (!node) return null;
      const rows = [...node.querySelectorAll('[data-child-id]')];
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect();
        if (client.y < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      return { columnId: col.id, index };
    },
    [boardId, toLocal],
  );

  // ----- pointer state machine -----

  const beginDrag = useCallback(
    (e: ReactPointerEvent, element: Element) => {
      const state = useStore.getState();
      let ids: string[];
      let soloCandidate: string | null = null;
      let toggleCandidate: string | null = null;

      const isSelected = state.selection.includes(element.id);
      if (!isSelected) {
        ids = e.shiftKey ? [...state.selection, element.id] : [element.id];
        setSelection(ids);
      } else if (e.shiftKey) {
        ids = state.selection;
        toggleCandidate = element.id;
      } else {
        ids = state.selection;
        soloCandidate = element.id;
      }

      const snapshots = new Map<string, Element>();
      for (const id of ids) {
        const el = state.elements[id];
        if (el && el.type !== 'line') snapshots.set(id, structuredClone(el));
      }
      const isTouch = e.pointerType === 'touch';
      const interaction: Extract<Interaction, { kind: 'drag' }> = {
        kind: 'drag',
        ids,
        snapshots,
        startWorld: toWorld({ x: e.clientX, y: e.clientY }),
        startClient: { x: e.clientX, y: e.clientY },
        moved: false,
        alt: e.altKey,
        duplicated: false,
        soloCandidate,
        toggleCandidate,
        touchPending: isTouch,
        longPressTimer: null,
      };
      if (isTouch) {
        interaction.longPressTimer = window.setTimeout(() => {
          const cur = interactionRef.current;
          if (cur.kind === 'drag' && cur.touchPending) {
            cur.touchPending = false;
            navigator.vibrate?.(10);
          }
        }, 300);
      }
      interactionRef.current = interaction;
    },
    [setSelection, toWorld],
  );

  const onElementPointerDown = useCallback(
    (e: ReactPointerEvent, element: Element) => {
      if (e.button === 1) return;
      if (spaceDown) return;
      if (useUiStore.getState().drawMode.active) return; // canvas draws on top
      if (editingElementId === element.id) return;
      e.stopPropagation();
      // Capture on the element itself (not the container): pointer capture
      // retargets derived click/dblclick events, and dblclick-to-edit must
      // still reach the element. Moves/ups bubble to the container handlers.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.button !== 0) return;
      beginDrag(e, element);
    },
    [beginDrag, editingElementId, spaceDown],
  );

  const onResizeHandleDown = useCallback(
    (e: ReactPointerEvent, element: Element, handle: Handle) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      containerRef.current?.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      interactionRef.current = {
        kind: 'resize',
        id: element.id,
        handle,
        snapshot: structuredClone(element),
        startWorld: toWorld({ x: e.clientX, y: e.clientY }),
      };
    },
    [toWorld],
  );

  const onAnchorDown = useCallback(
    (e: ReactPointerEvent, element: Element, side: Side) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      containerRef.current?.setPointerCapture(e.pointerId);
      interactionRef.current = {
        kind: 'line-draw',
        fromId: element.id,
        fromSide: side,
        moved: false,
      };
    },
    [],
  );

  const onLineEndpointDown = useCallback(
    (e: ReactPointerEvent, line: Element, end: 'from' | 'to') => {
      e.stopPropagation();
      if (e.button !== 0) return;
      containerRef.current?.setPointerCapture(e.pointerId);
      interactionRef.current = {
        kind: 'line-endpoint',
        lineId: line.id,
        end,
        snapshot: structuredClone(line),
        moved: false,
      };
    },
    [],
  );

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      containerRef.current?.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        pinchBaseRef.current = { dist, viewport: useStore.getState().viewport };
        interactionRef.current = { kind: 'pinch' };
        setMarqueeRect(null);
        return;
      }

      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        e.preventDefault();
        interactionRef.current = {
          kind: 'pan',
          start: { x: e.clientX, y: e.clientY },
          startViewport: useStore.getState().viewport,
        };
        setPanning(true);
        return;
      }

      if (e.button === 0) {
        // One-finger pan on empty canvas for touch (marquee is mouse-only).
        if (e.pointerType === 'touch' && !useUiStore.getState().drawMode.active) {
          interactionRef.current = {
            kind: 'pan',
            start: { x: e.clientX, y: e.clientY },
            startViewport: useStore.getState().viewport,
          };
          setPanning(true);
          const st = useStore.getState();
          if (st.editingElementId) setEditing(null);
          if (st.selection.length > 0) setSelection([]);
          return;
        }
        const draw = useUiStore.getState().drawMode;
        if (draw.active) {
          const world = toWorld({ x: e.clientX, y: e.clientY });
          if (draw.eraser) {
            interactionRef.current = { kind: 'erase', gesture: `erase:${e.pointerId}:${e.timeStamp}` };
          } else {
            interactionRef.current = { kind: 'draw', points: [world.x, world.y] };
            setTempStroke({ points: [world.x, world.y], color: draw.color, width: draw.width });
          }
          return;
        }
        const state = useStore.getState();
        interactionRef.current = {
          kind: 'marquee',
          startWorld: toWorld({ x: e.clientX, y: e.clientY }),
          additive: e.shiftKey,
          prevSelection: e.shiftKey ? state.selection : [],
          moved: false,
        };
        if (state.editingElementId) setEditing(null);
        if (openCommentId) setOpenCommentId(null);
      }
    },
    [openCommentId, setEditing, spaceDown, toWorld],
  );

  const processMove = useCallback(
    (client: Point) => {
      const interaction = interactionRef.current;
      const state = useStore.getState();

      if (interaction.kind === 'pinch') {
        const pts = [...pointersRef.current.values()];
        const base = pinchBaseRef.current;
        if (pts.length === 2 && base) {
          const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
          const mid = toLocal({
            x: (pts[0]!.x + pts[1]!.x) / 2,
            y: (pts[0]!.y + pts[1]!.y) / 2,
          });
          const scale = clampScale(base.viewport.scale * (dist / base.dist));
          setViewport(zoomAt(state.viewport, mid, scale));
        }
        return;
      }

      if (interaction.kind === 'pan') {
        setViewport({
          ...interaction.startViewport,
          x: interaction.startViewport.x + (client.x - interaction.start.x),
          y: interaction.startViewport.y + (client.y - interaction.start.y),
        });
        return;
      }

      if (interaction.kind === 'draw') {
        const world = screenToWorld(toLocal(client), state.viewport);
        const pts = interaction.points;
        const lastX = pts[pts.length - 2]!;
        const lastY = pts[pts.length - 1]!;
        if (Math.hypot(world.x - lastX, world.y - lastY) > 0.75 / state.viewport.scale) {
          pts.push(world.x, world.y);
          const draw = useUiStore.getState().drawMode;
          setTempStroke({ points: [...pts], color: draw.color, width: draw.width });
        }
        return;
      }

      if (interaction.kind === 'erase') {
        const world = screenToWorld(toLocal(client), state.viewport);
        const radius = 10 / state.viewport.scale;
        for (const el of Object.values(state.elements)) {
          if (el.boardId !== boardId || el.type !== 'drawing') continue;
          const c = el.content as DrawingContent;
          const lx = world.x - el.x;
          const ly = world.y - el.y;
          const survivors = c.paths.filter(
            (p) => distanceToPath(lx, ly, p.points) > radius + p.width / 2,
          );
          if (survivors.length === c.paths.length) continue;
          const after =
            survivors.length === 0
              ? null
              : { ...el, content: { paths: survivors } };
          execute({
            label: 'Erase',
            coalesceKey: interaction.gesture,
            changes: [{ entity: 'element', id: el.id, before: el, after }],
          });
        }
        return;
      }

      if (interaction.kind === 'line-draw') {
        const from = state.elements[interaction.fromId];
        if (!from) return;
        const a = anchorPoint(from, interaction.fromSide);
        const world = screenToWorld(toLocal(client), state.viewport);
        if (Math.hypot(world.x - a.x, world.y - a.y) > 8 / state.viewport.scale) {
          interaction.moved = true;
        }
        setTempLine({ d: `M ${a.x} ${a.y} L ${world.x} ${world.y}` });
        return;
      }

      if (interaction.kind === 'line-endpoint') {
        const cur = state.elements[interaction.lineId];
        if (!cur) return;
        const world = screenToWorld(toLocal(client), state.viewport);
        interaction.moved = true;
        const content: LineContent = {
          ...(cur.content as LineContent),
          [interaction.end]: { point: world },
        };
        updateEphemeral({ [interaction.lineId]: { content } });
        return;
      }

      if (interaction.kind === 'marquee') {
        const current = screenToWorld(toLocal(client), state.viewport);
        const rect: Rect = {
          x: Math.min(interaction.startWorld.x, current.x),
          y: Math.min(interaction.startWorld.y, current.y),
          w: Math.abs(current.x - interaction.startWorld.x),
          h: Math.abs(current.y - interaction.startWorld.y),
        };
        if (rect.w > 2 || rect.h > 2) interaction.moved = true;
        setMarqueeRect(rect);
        const hit = Object.values(state.elements)
          .filter(
            (el) =>
              el.boardId === boardId &&
              el.parentColumnId === null &&
              el.type !== 'line' &&
              el.type !== 'comment' &&
              rectsIntersect(rect, elementRect(el)),
          )
          .map((el) => el.id);
        const union = interaction.additive
          ? [...new Set([...interaction.prevSelection, ...hit])]
          : hit;
        setSelection(union);
        return;
      }

      if (interaction.kind === 'drag') {
        if (interaction.touchPending) {
          // Long-press hasn't fired yet: early movement means the user is
          // panning the canvas with one finger, not moving the card.
          const distPx = Math.hypot(
            client.x - interaction.startClient.x,
            client.y - interaction.startClient.y,
          );
          if (distPx > 10) {
            if (interaction.longPressTimer !== null) {
              clearTimeout(interaction.longPressTimer);
            }
            interactionRef.current = {
              kind: 'pan',
              start: interaction.startClient,
              startViewport: state.viewport,
            };
            setPanning(true);
          }
          return;
        }
        const world = screenToWorld(toLocal(client), state.viewport);
        const rawDx = world.x - interaction.startWorld.x;
        const rawDy = world.y - interaction.startWorld.y;
        if (!interaction.moved) {
          const distPx = Math.hypot(rawDx, rawDy) * state.viewport.scale;
          if (distPx < DRAG_THRESHOLD_PX) return;
          interaction.moved = true;

          if (interaction.alt && !interaction.duplicated) {
            const originals = [...interaction.snapshots.values()];
            const { command, newIds } = duplicateElementsCmd(originals, 0);
            const key = `altdrag:${newIds[0] ?? ''}`;
            command.coalesceKey = key;
            execute(command);
            setSelection(newIds);
            const snapshots = new Map<string, Element>();
            const fresh = useStore.getState().elements;
            for (const id of newIds) {
              const el = fresh[id];
              if (el) snapshots.set(id, structuredClone(el));
            }
            interaction.ids = newIds;
            interaction.snapshots = snapshots;
            interaction.duplicated = true;
            interaction.coalesceKey = key;
          }
        }

        // Column drop target (only when every dragged card can live in one).
        const draggedIds = new Set(interaction.snapshots.keys());
        const allColumnable = [...interaction.snapshots.values()].every((el) =>
          COLUMNABLE.has(el.type),
        );
        const drop = allColumnable ? findColumnDrop(client, draggedIds) : null;
        useUiStore.getState().setColumnDropTarget(drop);

        const snaps = [...interaction.snapshots.values()];
        const bbox = boundingBox(snaps.map(elementRect));
        let dx = rawDx;
        let dy = rawDy;
        let nextGuides: SnapGuide[] = [];
        if (bbox && !drop) {
          const moving: Rect = { ...bbox, x: bbox.x + rawDx, y: bbox.y + rawDy };
          const others = Object.values(state.elements).filter(
            (el) =>
              el.boardId === boardId &&
              el.parentColumnId === null &&
              el.type !== 'line' &&
              el.type !== 'comment' &&
              !interaction.snapshots.has(el.id),
          );
          const snap = computeSnap(
            moving,
            others,
            SNAP_THRESHOLD_PX / state.viewport.scale,
          );
          dx += snap.dx;
          dy += snap.dy;
          nextGuides = snap.guides;
        }
        setGuides(nextGuides);
        const patches: Record<string, Partial<Element>> = {};
        for (const [id, snap] of interaction.snapshots) {
          patches[id] = { x: snap.x + dx, y: snap.y + dy };
        }
        updateEphemeral(patches);
        return;
      }

      if (interaction.kind === 'resize') {
        const world = screenToWorld(toLocal(client), state.viewport);
        const dx = world.x - interaction.startWorld.x;
        const dy = world.y - interaction.startWorld.y;
        const s = interaction.snapshot;
        let { x, y, w, h } = s;
        const hd = interaction.handle;

        if (s.type === 'image') {
          // Aspect-locked corner resize.
          const ratio = s.w / Math.max(1, s.h);
          const dw = hd.includes('w') ? -dx : dx;
          w = Math.max(MIN_W, s.w + dw);
          h = Math.max(MIN_H, w / ratio);
          w = h * ratio;
          if (hd.includes('w')) x = s.x + (s.w - w);
          if (hd.includes('n')) y = s.y + (s.h - h);
        } else {
          if (hd.includes('e')) w = Math.max(MIN_W, s.w + dx);
          if (hd.includes('s')) h = Math.max(MIN_H, s.h + dy);
          if (hd.includes('w')) {
            w = Math.max(MIN_W, s.w - dx);
            x = s.x + (s.w - w);
          }
          if (hd.includes('n')) {
            h = Math.max(MIN_H, s.h - dy);
            y = s.y + (s.h - h);
          }
        }
        updateEphemeral({ [s.id]: { x, y, w, h } });
      }
    },
    [boardId, execute, findColumnDrop, setSelection, setViewport, toLocal, updateEphemeral],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (interactionRef.current.kind === 'idle') return;
      pendingMoveRef.current = { x: e.clientX, y: e.clientY };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const pending = pendingMoveRef.current;
          if (pending) processMove(pending);
        });
      }
    },
    [processMove],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      const interaction = interactionRef.current;

      if (interaction.kind === 'pinch') {
        if (pointersRef.current.size < 2) {
          pinchBaseRef.current = null;
          interactionRef.current = { kind: 'idle' };
        }
        return;
      }

      interactionRef.current = { kind: 'idle' };
      setPanning(false);
      setMarqueeRect(null);
      setGuides([]);
      setTempLine(null);
      setTempStroke(null);

      if (interaction.kind === 'erase') {
        useStore.getState().breakCoalescing();
        return;
      }

      if (interaction.kind === 'draw') {
        const state = useStore.getState();
        const draw = useUiStore.getState().drawMode;
        const simplified = simplifyPoints(interaction.points, 0.8);
        if (simplified.length < 4) return;
        const PADDING = 8;
        const sb = strokeBounds(simplified);
        const activeId = draw.activeDrawingId;
        const existing = activeId ? state.elements[activeId] : undefined;

        if (existing && existing.boardId === boardId) {
          // Extend the session's drawing: union bounds, shift local coords.
          const nx = Math.min(existing.x, sb.x - PADDING);
          const ny = Math.min(existing.y, sb.y - PADDING);
          const nr = Math.max(existing.x + existing.w, sb.x + sb.w + PADDING);
          const nb = Math.max(existing.y + existing.h, sb.y + sb.h + PADDING);
          const shiftX = existing.x - nx;
          const shiftY = existing.y - ny;
          const c = existing.content as DrawingContent;
          const paths = c.paths.map((p) => ({
            ...p,
            points:
              shiftX || shiftY
                ? p.points.map((v, i) => (i % 2 === 0 ? v + shiftX : v + shiftY))
                : p.points,
          }));
          paths.push({
            points: simplified.map((v, i) => (i % 2 === 0 ? v - nx : v - ny)),
            color: draw.color,
            width: draw.width,
          });
          execute({
            label: 'Draw',
            changes: [
              {
                entity: 'element',
                id: existing.id,
                before: existing,
                after: {
                  ...existing,
                  x: nx,
                  y: ny,
                  w: nr - nx,
                  h: nb - ny,
                  content: { paths },
                },
              },
            ],
          });
        } else {
          const el = buildElement(
            boardId,
            'drawing',
            sb.x - PADDING,
            sb.y - PADDING,
            maxZ + 1,
            {
              w: sb.w + PADDING * 2,
              h: sb.h + PADDING * 2,
              content: {
                paths: [
                  {
                    points: simplified.map((v, i) =>
                      i % 2 === 0 ? v - (sb.x - PADDING) : v - (sb.y - PADDING),
                    ),
                    color: draw.color,
                    width: draw.width,
                  },
                ],
              },
            },
          );
          execute({
            label: 'Draw',
            changes: [{ entity: 'element', id: el.id, before: null, after: el }],
          });
          useUiStore.getState().setDrawMode({ activeDrawingId: el.id });
        }
        return;
      }

      if (interaction.kind === 'line-draw') {
        if (!interaction.moved) return;
        const state = useStore.getState();
        const world = toWorld({ x: e.clientX, y: e.clientY });
        const target = topElementAt(
          state.elements,
          boardId,
          world,
          new Set([interaction.fromId]),
        );
        const content: LineContent = {
          from: { elementId: interaction.fromId, side: interaction.fromSide },
          to: target ? { elementId: target.id } : { point: world },
          curve: false,
          dashed: false,
          arrowEnd: true,
        };
        const fromEl = state.elements[interaction.fromId];
        const a = fromEl
          ? anchorPoint(fromEl, interaction.fromSide)
          : world;
        const el = buildElement(boardId, 'line', a.x, a.y, maxZ + 1, {
          w: 0,
          h: 0,
          content,
        });
        execute({
          label: 'Connect',
          changes: [{ entity: 'element', id: el.id, before: null, after: el }],
        });
        setSelection([el.id]);
        return;
      }

      if (interaction.kind === 'line-endpoint') {
        if (!interaction.moved) return;
        const state = useStore.getState();
        const world = toWorld({ x: e.clientX, y: e.clientY });
        const before = interaction.snapshot;
        // Snap onto a card under the cursor, otherwise drop as a free point.
        const target = topElementAt(
          state.elements,
          boardId,
          world,
          new Set([interaction.lineId]),
        );
        const endpoint: LineEndpoint = target
          ? { elementId: target.id }
          : { point: world };
        const after: Element = {
          ...before,
          content: { ...(before.content as LineContent), [interaction.end]: endpoint },
        };
        execute(updateElementsCmd('Move endpoint', [before], [after]));
        return;
      }

      if (interaction.kind === 'marquee') {
        if (!interaction.moved) {
          setSelection(interaction.additive ? interaction.prevSelection : []);
        }
        return;
      }

      if (interaction.kind === 'drag') {
        if (interaction.longPressTimer !== null) {
          clearTimeout(interaction.longPressTimer);
        }
        const state = useStore.getState();
        const drop = useUiStore.getState().columnDropTarget;
        useUiStore.getState().setColumnDropTarget(null);

        // Dropped on a sidebar board row → move elements to that board.
        if (interaction.moved) {
          const navRow = (
            document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
          )?.closest('[data-board-nav-id]');
          const targetBoardId = navRow?.getAttribute('data-board-nav-id');
          if (targetBoardId && targetBoardId !== boardId) {
            // Restore original positions first so the move lands cleanly.
            const patches: Record<string, Partial<Element>> = {};
            for (const [id, snap] of interaction.snapshots) {
              patches[id] = { x: snap.x, y: snap.y };
            }
            updateEphemeral(patches);
            const originals = [...interaction.snapshots.values()];
            execute(
              moveElementsToBoardCmd(originals, state.elements, targetBoardId),
            );
            setSelection([]);
            return;
          }
        }

        if (interaction.moved && drop) {
          // Drop into a column: insert at the indicated index.
          const children = columnChildren(state.elements, drop.columnId).filter(
            (ch) => !interaction.snapshots.has(ch.id),
          );
          const beforeSi =
            drop.index > 0
              ? (children[Math.min(drop.index, children.length) - 1]?.sortIndex ?? 0)
              : (children[0]?.sortIndex ?? 1) - 2;
          const afterSi =
            drop.index < children.length
              ? children[drop.index]!.sortIndex
              : beforeSi + 2;
          const dragged = [...interaction.snapshots.values()];
          const after = dragged.map((snap, i) => {
            const current = state.elements[snap.id] ?? snap;
            return {
              ...structuredClone(current),
              x: snap.x,
              y: snap.y,
              parentColumnId: drop.columnId,
              sortIndex: beforeSi + ((afterSi - beforeSi) * (i + 1)) / (dragged.length + 1),
            };
          });
          execute(updateElementsCmd('Move into column', dragged, after, interaction.coalesceKey));
          if (interaction.coalesceKey) useStore.getState().breakCoalescing();
          return;
        }

        if (interaction.moved) {
          const before = [...interaction.snapshots.values()];
          const after = before
            .map((snap) => state.elements[snap.id])
            .filter((el): el is Element => !!el)
            .map((el) => structuredClone(el));
          execute(updateElementsCmd('Move', before, after, interaction.coalesceKey));
          if (interaction.coalesceKey) useStore.getState().breakCoalescing();
        } else if (interaction.toggleCandidate) {
          setSelection(
            state.selection.filter((id) => id !== interaction.toggleCandidate),
          );
        } else if (interaction.soloCandidate) {
          setSelection([interaction.soloCandidate]);
        }
        return;
      }

      if (interaction.kind === 'resize') {
        const state = useStore.getState();
        const current = state.elements[interaction.id];
        if (
          current &&
          (current.x !== interaction.snapshot.x ||
            current.y !== interaction.snapshot.y ||
            current.w !== interaction.snapshot.w ||
            current.h !== interaction.snapshot.h)
        ) {
          execute(
            updateElementsCmd(
              'Resize',
              [interaction.snapshot],
              [structuredClone(current)],
            ),
          );
        }
      }
    },
    [boardId, execute, maxZ, setSelection, toWorld],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const world = toWorld({ x: e.clientX, y: e.clientY });
      const el = buildElement(boardId, 'note', world.x, world.y - 20, maxZ + 1);
      execute({
        label: 'Create note',
        changes: [{ entity: 'element', id: el.id, before: null, after: el }],
      });
      setSelection([el.id]);
      setEditing(el.id);
    },
    [boardId, execute, maxZ, setEditing, setSelection, toWorld],
  );

  // Delete the current selection (with dependent lines/comments/column kids).
  // Used by the keyboard handler and the mobile trash button.
  const deleteSelected = useCallback(() => {
    const state = useStore.getState();
    if (state.selection.length === 0) return;
    const selected = state.selection
      .map((id) => state.elements[id])
      .filter((el): el is Element => !!el);
    if (selected.length === 0) return;
    execute(deleteElementsCmd(withDependents(state.elements, boardId, selected)));
    setSelection([]);
    setOpenCommentId(null);
  }, [boardId, execute, setSelection]);

  // ----- search-result flash: center + highlight the element -----

  const flashElementId = useUiStore((s) => s.flashElementId);
  useEffect(() => {
    if (!flashElementId) return;
    const el = useStore.getState().elements[flashElementId];
    if (!el || el.boardId !== boardId) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const scale = useStore.getState().viewport.scale;
      setViewport({
        scale,
        x: rect.width / 2 - (el.x + el.w / 2) * scale,
        y: rect.height / 2 - (el.y + el.h / 2) * scale,
      });
    }
    setSelection([flashElementId]);
    const timer = setTimeout(
      () => useUiStore.getState().setFlashElementId(null),
      1600,
    );
    return () => clearTimeout(timer);
  }, [flashElementId, boardId, elements[flashElementId ?? ''] !== undefined, setSelection, setViewport]);

  // Open a freshly-created comment for editing (signalled from the toolbar).
  const pendingCommentOpen = useUiStore((s) => s.pendingCommentOpen);
  useEffect(() => {
    if (!pendingCommentOpen) return;
    const el = useStore.getState().elements[pendingCommentOpen];
    if (el && el.boardId === boardId) {
      setOpenCommentId(pendingCommentOpen);
      setSelection([pendingCommentOpen]);
    }
    useUiStore.getState().setPendingCommentOpen(null);
  }, [pendingCommentOpen, boardId, setSelection]);

  // ----- dnd-kit: sorting inside columns + drag out to canvas -----

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const { setNodeRef: setCanvasDropRef } = useDroppable({ id: 'canvas' });

  const collision: CollisionDetection = useCallback((args) => {
    const within = pointerWithin(args);
    // Child cards beat their column container; columns beat the canvas.
    const items = within.filter(
      (c) => c.id !== 'canvas' && !String(c.id).startsWith('column:'),
    );
    if (items.length > 0) return items;
    const columns = within.filter((c) => String(c.id).startsWith('column:'));
    return columns.length > 0 ? columns : within;
  }, []);

  const onDndStart = useCallback((e: DragStartEvent) => {
    setDndActiveId(String(e.active.id));
  }, []);

  const onDndEnd = useCallback(
    (e: DragEndEvent) => {
      setDndActiveId(null);
      const state = useStore.getState();
      const activeId = String(e.active.id);
      const child = state.elements[activeId];
      if (!child || !child.parentColumnId) return;
      const overId = e.over ? String(e.over.id) : 'canvas';

      if (overId === 'canvas') {
        // Drag out: place at the card's translated position.
        const rect = e.active.rect.current.translated;
        const canvasRect = containerRef.current?.getBoundingClientRect();
        if (!rect || !canvasRect) return;
        const world = screenToWorld(
          { x: rect.left - canvasRect.left, y: rect.top - canvasRect.top },
          state.viewport,
        );
        const after: Element = {
          ...structuredClone(child),
          parentColumnId: null,
          x: world.x,
          y: world.y,
          zIndex: maxZ + 1,
        };
        execute(updateElementsCmd('Move out of column', [structuredClone(child)], [after]));
        setSelection([activeId]);
        return;
      }

      let targetColumnId: string;
      let targetIndex: number;
      if (overId.startsWith('column:')) {
        targetColumnId = overId.slice('column:'.length);
        // Index from the dragged card's vertical center vs. existing rows.
        targetIndex = Number.MAX_SAFE_INTEGER;
        const dragRect = e.active.rect.current.translated;
        const colNode = document.querySelector(
          `[data-column-id="${targetColumnId}"]`,
        );
        if (dragRect && colNode) {
          const midY = dragRect.top + dragRect.height / 2;
          const rows = [...colNode.querySelectorAll('[data-child-id]')].filter(
            (r) => r.getAttribute('data-child-id') !== activeId,
          );
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i]!.getBoundingClientRect();
            if (midY < r.top + r.height / 2) {
              targetIndex = i;
              break;
            }
          }
        }
      } else {
        const overEl = state.elements[overId];
        if (!overEl || !overEl.parentColumnId) return;
        targetColumnId = overEl.parentColumnId;
        const list = columnChildren(state.elements, targetColumnId);
        targetIndex = list.findIndex((c) => c.id === overId);
      }

      const list = columnChildren(state.elements, targetColumnId).filter(
        (c) => c.id !== activeId,
      );
      const idx = Math.min(targetIndex, list.length);
      list.splice(idx, 0, child);

      const before: Element[] = [];
      const after: Element[] = [];
      list.forEach((el, i) => {
        const target =
          el.id === activeId
            ? { ...structuredClone(el), parentColumnId: targetColumnId, sortIndex: i }
            : { ...structuredClone(el), sortIndex: i };
        if (el.sortIndex !== i || el.id === activeId) {
          before.push(structuredClone(el));
          after.push(target);
        }
      });
      if (after.length > 0) {
        execute(updateElementsCmd('Reorder column', before, after));
      }
    },
    [execute, maxZ, setSelection],
  );

  const dndActiveElement = dndActiveId ? elements[dndActiveId] : undefined;

  // ----- render -----

  // Viewport virtualization: only mount cards intersecting the visible world
  // rect (+ margin). Selected/editing cards always render.
  const VIRTUAL_MARGIN = 300;
  const renderedCards = useMemo(() => {
    if (containerSize.w === 0) return cardElements;
    const view: Rect = {
      x: -viewport.x / viewport.scale - VIRTUAL_MARGIN,
      y: -viewport.y / viewport.scale - VIRTUAL_MARGIN,
      w: containerSize.w / viewport.scale + VIRTUAL_MARGIN * 2,
      h: containerSize.h / viewport.scale + VIRTUAL_MARGIN * 2,
    };
    return cardElements.filter(
      (el) =>
        rectsIntersect(view, elementRect(el)) ||
        selection.includes(el.id) ||
        el.id === editingElementId,
    );
  }, [cardElements, containerSize, viewport, selection, editingElementId]);

  const spacing = GRID_SPACING * viewport.scale;
  const singleSelected =
    selectedElements.length === 1 ? selectedElements[0] : undefined;
  const singleLine =
    singleSelected?.type === 'line' ? singleSelected : undefined;
  const anchorSource =
    singleSelected &&
    singleSelected.type !== 'line' &&
    singleSelected.type !== 'comment' &&
    editingElementId !== singleSelected.id
      ? singleSelected
      : undefined;

  const handlesFor = (el: Element): Handle[] => {
    if (el.type === 'image') return ['nw', 'ne', 'se', 'sw'];
    if (el.type === 'drawing') return []; // drawings move but don't resize
    if (AUTO_HEIGHT.has(el.type)) return ['e', 'w'];
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  };

  const setContainerRefs = useCallback(
    (node: HTMLDivElement | null) => {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      setCanvasDropRef(node);
    },
    [setCanvasDropRef],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDndStart}
      onDragEnd={onDndEnd}
      onDragCancel={() => setDndActiveId(null)}
    >
      <div
        ref={setContainerRefs}
        data-testid="canvas"
        className={`relative flex-1 touch-none overflow-hidden bg-canvas ${
          panning
            ? 'cursor-grabbing'
            : spaceDown
              ? 'cursor-grab'
              : drawActive
                ? 'cursor-crosshair'
                : ''
        }`}
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--color-grid-dot) 1px, transparent 1px)',
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {/* world layer */}
        <div
          data-world
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          <LineLayer
            lines={lineElements}
            elements={elements}
            selection={selection}
            onSelect={(id, additive) =>
              setSelection(
                additive ? [...new Set([...selection, id])] : [id],
              )
            }
            temp={tempLine}
          />

          {renderedCards.map((el) => (
            <ElementView
              key={el.id}
              element={el}
              selected={selection.includes(el.id)}
              editing={editingElementId === el.id}
              flashing={flashElementId === el.id}
              onPointerDown={onElementPointerDown}
            />
          ))}

          {commentElements.map((el) => (
            <CommentPin
              key={el.id}
              element={el}
              elements={elements}
              open={openCommentId === el.id}
              onOpen={setOpenCommentId}
              scale={viewport.scale}
            />
          ))}

          {/* in-progress freehand stroke */}
          {tempStroke && tempStroke.points.length >= 4 && (
            <svg
              className="pointer-events-none absolute left-0 top-0"
              style={{ width: 1, height: 1, overflow: 'visible' }}
            >
              <polyline
                points={Array.from(
                  { length: tempStroke.points.length / 2 },
                  (_, j) => `${tempStroke.points[j * 2]},${tempStroke.points[j * 2 + 1]}`,
                ).join(' ')}
                fill="none"
                stroke={tempStroke.color}
                strokeWidth={tempStroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}

          {/* line anchors on the selected card */}
          {anchorSource && (
            <LineAnchors element={anchorSource} scale={viewport.scale} onAnchorDown={onAnchorDown} />
          )}

          {/* draggable endpoints on the selected line */}
          {singleLine && (
            <LineEndpoints
              line={singleLine}
              elements={elements}
              scale={viewport.scale}
              onEndpointDown={onLineEndpointDown}
            />
          )}

          {/* resize handles for single selection */}
          {singleSelected &&
            singleSelected.type !== 'line' &&
            singleSelected.type !== 'comment' &&
            editingElementId !== singleSelected.id && (
              <ResizeHandles
                element={singleSelected}
                scale={viewport.scale}
                handles={handlesFor(singleSelected)}
                onHandleDown={onResizeHandleDown}
              />
            )}
        </div>

        {/* overlay: snap guides + marquee (screen space) */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <line
                key={i}
                x1={g.at * viewport.scale + viewport.x}
                x2={g.at * viewport.scale + viewport.x}
                y1={g.from * viewport.scale + viewport.y}
                y2={g.to * viewport.scale + viewport.y}
                stroke="var(--color-accent)"
                strokeWidth={1}
              />
            ) : (
              <line
                key={i}
                x1={g.from * viewport.scale + viewport.x}
                x2={g.to * viewport.scale + viewport.x}
                y1={g.at * viewport.scale + viewport.y}
                y2={g.at * viewport.scale + viewport.y}
                stroke="var(--color-accent)"
                strokeWidth={1}
              />
            ),
          )}
          {marqueeRect && (
            <rect
              x={marqueeRect.x * viewport.scale + viewport.x}
              y={marqueeRect.y * viewport.scale + viewport.y}
              width={marqueeRect.w * viewport.scale}
              height={marqueeRect.h * viewport.scale}
              fill="var(--color-accent)"
              fillOpacity={0.08}
              stroke="var(--color-accent)"
              strokeWidth={1}
            />
          )}
        </svg>

        {/* floating line property toolbar */}
        {singleLine && (
          <LinePropertyBar line={singleLine} elements={elements} viewport={viewport} />
        )}

        {boardElements.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm text-center text-ink-soft">
              <p className="text-lg font-medium">This board is empty</p>
              <p className="mt-2 text-sm">
                Double-click anywhere to write a note, drag an element in from
                the toolbar, or paste an image or link.
              </p>
            </div>
          </div>
        )}

        {/* Mobile: delete the selection (no keyboard available in the APK). */}
        {selection.length > 0 && (
          <button
            aria-label="Delete selected"
            title="Delete selected"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={deleteSelected}
            className="absolute bottom-20 left-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-card-border bg-card text-red-600 shadow-card-drag active:scale-95 sm:hidden"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}

        <DrawBar />
        <ZoomControls containerRef={containerRef} boardElements={cardElements} />
      </div>

      <DragOverlay>
        {dndActiveElement ? (
          <div
            className="rounded-md border border-card-border bg-card shadow-card-drag"
            style={{ width: 215 }}
          >
            <ElementBody element={dndActiveElement} editing={false} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function LineEndpoints({
  line,
  elements,
  scale,
  onEndpointDown,
}: {
  line: Element;
  elements: Record<string, Element>;
  scale: number;
  onEndpointDown: (e: ReactPointerEvent, line: Element, end: 'from' | 'to') => void;
}) {
  const geo = linePath(line.content as LineContent, elements);
  if (!geo) return null;
  const size = 12 / scale;
  const half = size / 2;
  const dot = (p: ResolvedEnd, end: 'from' | 'to') => (
    <div
      key={end}
      aria-label={`Line ${end} endpoint`}
      onPointerDown={(e) => onEndpointDown(e, line, end)}
      className="pointer-events-auto absolute cursor-grab rounded-full border border-accent bg-card hover:bg-accent-soft"
      style={{
        left: p.x - half,
        top: p.y - half,
        width: size,
        height: size,
        borderWidth: Math.max(1.5, 2 / scale),
      }}
    />
  );
  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{ zIndex: 100002 }}
    >
      {dot(geo.from, 'from')}
      {dot(geo.to, 'to')}
    </div>
  );
}

function LineAnchors({
  element,
  scale,
  onAnchorDown,
}: {
  element: Element;
  scale: number;
  onAnchorDown: (e: ReactPointerEvent, element: Element, side: Side) => void;
}) {
  const size = 10 / scale;
  const half = size / 2;
  const spots: { side: Side; left: number; top: number }[] = [
    { side: 'n', left: element.w / 2 - half, top: -14 / scale },
    { side: 'e', left: element.w + 14 / scale - size, top: element.h / 2 - half },
    { side: 's', left: element.w / 2 - half, top: element.h + 14 / scale - size },
    { side: 'w', left: -14 / scale, top: element.h / 2 - half },
  ];
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        zIndex: 100001,
      }}
    >
      {spots.map((s) => (
        <div
          key={s.side}
          data-anchor={s.side}
          onPointerDown={(e) => onAnchorDown(e, element, s.side)}
          className="pointer-events-auto absolute cursor-crosshair rounded-full border border-accent bg-white hover:bg-accent-soft"
          style={{
            left: s.left,
            top: s.top,
            width: size,
            height: size,
            borderWidth: Math.max(1, 1.5 / scale),
          }}
        />
      ))}
    </div>
  );
}

function LinePropertyBar({
  line,
  elements,
  viewport,
}: {
  line: Element;
  elements: Record<string, Element>;
  viewport: { x: number; y: number; scale: number };
}) {
  const execute = useStore((s) => s.execute);
  const setSelection = useStore((s) => s.setSelection);
  const c = line.content as LineContent;

  // Position above the line's midpoint (screen space).
  const geoFrom = c.from;
  const geoTo = c.to;
  const p1 = 'point' in geoFrom ? geoFrom.point : centerOf(elements[geoFrom.elementId]);
  const p2 = 'point' in geoTo ? geoTo.point : centerOf(elements[geoTo.elementId]);
  if (!p1 || !p2) return null;
  const mid = worldToScreen(
    { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    viewport,
  );
  // Keep the bar on-screen: when the line's midpoint is near the top edge,
  // its default position (mid.y - 48) would render the bar off-canvas.
  const barTop = mid.y - 48 < 8 ? mid.y + 24 : mid.y - 48;

  function toggle(prop: 'curve' | 'dashed' | 'arrowEnd') {
    const state = useStore.getState();
    const before = state.elements[line.id];
    if (!before) return;
    const bc = before.content as LineContent;
    const after: Element = { ...before, content: { ...bc, [prop]: !bc[prop] } };
    execute({
      label: 'Edit line',
      changes: [{ entity: 'element', id: line.id, before, after }],
    });
  }

  function remove() {
    execute(deleteElementsCmd([line]));
    setSelection([]);
  }

  const btn = (active: boolean) =>
    `rounded p-1.5 text-xs ${active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-panel-border/60 hover:text-ink'}`;

  return (
    <div
      className="absolute z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-card-border bg-card px-1 py-0.5 shadow-card-drag"
      style={{ left: mid.x, top: barTop }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button aria-label="Toggle curve" title="Curved" className={btn(c.curve)} onClick={() => toggle('curve')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 13 C 6 13, 10 3, 14 3" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
      <button aria-label="Toggle dashed" title="Dashed" className={btn(c.dashed)} onClick={() => toggle('dashed')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1 8 H 15" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.5" />
        </svg>
      </button>
      <button aria-label="Toggle arrowhead" title="Arrowhead" className={btn(c.arrowEnd)} onClick={() => toggle('arrowEnd')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1 8 H 13 M 9 4 L 13 8 L 9 12" stroke="currentColor" strokeWidth="1.8" fill="none" />
        </svg>
      </button>
      <span className="mx-0.5 h-4 w-px bg-card-border" />
      <button
        aria-label="Delete line"
        title="Delete"
        className={btn(false)}
        onClick={remove}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 4 H 13 M 6 4 V 2.5 H 10 V 4 M 5 4 L 5.7 13.5 H 10.3 L 11 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
    </div>
  );
}

function centerOf(el: Element | undefined): { x: number; y: number } | null {
  if (!el) return null;
  return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
}

const COARSE_POINTER =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)').matches;

function ResizeHandles({
  element,
  scale,
  handles,
  onHandleDown,
}: {
  element: Element;
  scale: number;
  handles: Handle[];
  onHandleDown: (e: ReactPointerEvent, element: Element, handle: Handle) => void;
}) {
  const size = (COARSE_POINTER ? 16 : 8) / scale;
  const half = size / 2;
  const pos: Record<Handle, { left: number; top: number; cursor: string }> = {
    nw: { left: -half, top: -half, cursor: 'nwse-resize' },
    n: { left: element.w / 2 - half, top: -half, cursor: 'ns-resize' },
    ne: { left: element.w - half, top: -half, cursor: 'nesw-resize' },
    e: { left: element.w - half, top: element.h / 2 - half, cursor: 'ew-resize' },
    se: { left: element.w - half, top: element.h - half, cursor: 'nwse-resize' },
    s: { left: element.w / 2 - half, top: element.h - half, cursor: 'ns-resize' },
    sw: { left: -half, top: element.h - half, cursor: 'nesw-resize' },
    w: { left: -half, top: element.h / 2 - half, cursor: 'ew-resize' },
  };
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        zIndex: 100000,
      }}
    >
      {handles.map((h) => (
        <div
          key={h}
          data-handle={h}
          onPointerDown={(e) => onHandleDown(e, element, h)}
          className="pointer-events-auto absolute rounded-sm border border-accent bg-white"
          style={{
            left: pos[h].left,
            top: pos[h].top,
            width: size,
            height: size,
            cursor: pos[h].cursor,
            borderWidth: Math.max(1, 1 / scale),
          }}
        />
      ))}
    </div>
  );
}
