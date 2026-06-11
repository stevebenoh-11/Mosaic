import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '@/store';
import { useUiStore, isTypingTarget } from '@/ui/uiStore';
import type { Element } from '@/db/types';
import {
  buildElement,
  deleteElementsCmd,
  duplicateElementsCmd,
  updateElementsCmd,
  zOrderCmd,
} from '@/store/elementCommands';
import { ElementView } from '@/elements/ElementView';
import {
  boundingBox,
  clampScale,
  elementRect,
  rectsIntersect,
  screenToWorld,
  zoomAt,
  type Point,
  type Rect,
} from './coords';
import { computeSnap, type SnapGuide } from './snapping';
import { ZoomControls } from './ZoomControls';

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
      moved: boolean;
      alt: boolean;
      duplicated: boolean;
      coalesceKey?: string;
      soloCandidate: string | null;
      toggleCandidate: string | null;
    }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      snapshot: Element;
      startWorld: Point;
    }
  | { kind: 'pinch' };

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

  const containerRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction>({ kind: 'idle' });
  const pointersRef = useRef(new Map<number, Point>());
  const pinchBaseRef = useRef<{ dist: number; viewport: typeof viewport } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number; client: Point } | null>(null);

  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);

  const boardElements = useMemo(
    () =>
      Object.values(elements).filter(
        (e) => e.boardId === boardId && e.parentColumnId === null,
      ),
    [elements, boardId],
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
    (client: Point): Point => screenToWorld(toLocal(client), useStore.getState().viewport),
    [toLocal],
  );

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

  // ----- keyboard -----

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const state = useStore.getState();

      if (e.key === 'Escape') {
        const interaction = interactionRef.current;
        if (interaction.kind === 'drag' || interaction.kind === 'resize') {
          // Restore original geometry, abort the gesture.
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
        if (state.editingElementId) {
          setEditing(null); // keep selection
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
          .filter((el): el is Element => !!el);
        if (selected.length > 0) {
          const { command, newIds } = duplicateElementsCmd(selected, 16);
          execute(command);
          setSelection(newIds);
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.length > 0) {
        e.preventDefault();
        const selected = state.selection
          .map((id) => state.elements[id])
          .filter((el): el is Element => !!el);
        execute(deleteElementsCmd(selected));
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
        if (el && (el.type === 'note' || el.type === 'title')) {
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
  }, [boardId, execute, redo, setEditing, setSelection, setShortcutsOpen, undo, updateEphemeral]);

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
        if (el) snapshots.set(id, structuredClone(el));
      }
      interactionRef.current = {
        kind: 'drag',
        ids,
        snapshots,
        startWorld: toWorld({ x: e.clientX, y: e.clientY }),
        moved: false,
        alt: e.altKey,
        duplicated: false,
        soloCandidate,
        toggleCandidate,
      };
    },
    [setSelection, toWorld],
  );

  const onElementPointerDown = useCallback(
    (e: ReactPointerEvent, element: Element) => {
      if (e.button === 1) return; // container handles middle-mouse pan
      if (spaceDown) return; // container pans
      if (editingElementId === element.id) return; // editor owns the pointer
      e.stopPropagation();
      containerRef.current?.setPointerCapture(e.pointerId);
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

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      containerRef.current?.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2) {
        // Second finger: switch to pinch zoom.
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
        const state = useStore.getState();
        interactionRef.current = {
          kind: 'marquee',
          startWorld: toWorld({ x: e.clientX, y: e.clientY }),
          additive: e.shiftKey,
          prevSelection: e.shiftKey ? state.selection : [],
          moved: false,
        };
        if (state.editingElementId) setEditing(null);
      }
    },
    [setEditing, spaceDown, toWorld],
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
        const world = screenToWorld(toLocal(client), state.viewport);
        const rawDx = world.x - interaction.startWorld.x;
        const rawDy = world.y - interaction.startWorld.y;
        if (!interaction.moved) {
          const distPx = Math.hypot(rawDx, rawDy) * state.viewport.scale;
          if (distPx < DRAG_THRESHOLD_PX) return;
          interaction.moved = true;

          if (interaction.alt && !interaction.duplicated) {
            // Alt-drag: duplicate in place, then drag the copies. The same
            // coalesce key folds create + move into one undo step.
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

        const snaps = [...interaction.snapshots.values()];
        const bbox = boundingBox(snaps.map(elementRect));
        let dx = rawDx;
        let dy = rawDy;
        let nextGuides: SnapGuide[] = [];
        if (bbox) {
          const moving: Rect = { ...bbox, x: bbox.x + rawDx, y: bbox.y + rawDy };
          const others = Object.values(state.elements).filter(
            (el) =>
              el.boardId === boardId &&
              el.parentColumnId === null &&
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
        updateEphemeral({ [s.id]: { x, y, w, h } });
      }
    },
    [boardId, execute, setSelection, setViewport, toLocal, updateEphemeral],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (interactionRef.current.kind === 'idle') return;
      pendingMoveRef.current = {
        x: e.clientX,
        y: e.clientY,
        client: { x: e.clientX, y: e.clientY },
      };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const pending = pendingMoveRef.current;
          if (pending) processMove(pending.client);
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

      if (interaction.kind === 'marquee') {
        if (!interaction.moved) {
          setSelection(interaction.additive ? interaction.prevSelection : []);
        }
        return;
      }

      if (interaction.kind === 'drag') {
        const state = useStore.getState();
        if (interaction.moved) {
          const before = [...interaction.snapshots.values()];
          const after = before
            .map((snap) => state.elements[snap.id])
            .filter((el): el is Element => !!el)
            .map((el) => structuredClone(el));
          execute(
            updateElementsCmd(
              'Move',
              before,
              after,
              interaction.coalesceKey,
            ),
          );
          if (interaction.coalesceKey) {
            // Alt-drag session ends here; next command starts fresh.
            useStore.getState().breakCoalescing();
          }
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
    [execute, setSelection],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Only on empty canvas (elements stop propagation of their dblclicks).
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

  // ----- render -----

  const spacing = GRID_SPACING * viewport.scale;
  const singleSelected =
    selectedElements.length === 1 ? selectedElements[0] : undefined;

  const handlesFor = (el: Element): Handle[] =>
    el.type === 'note' || el.type === 'title'
      ? ['e', 'w']
      : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  return (
    <div
      ref={containerRef}
      data-testid="canvas"
      className={`relative flex-1 touch-none overflow-hidden bg-canvas ${
        panning ? 'cursor-grabbing' : spaceDown ? 'cursor-grab' : ''
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
    >
      {/* world layer */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {boardElements.map((el) => (
          <ElementView
            key={el.id}
            element={el}
            selected={selection.includes(el.id)}
            editing={editingElementId === el.id}
            onPointerDown={onElementPointerDown}
          />
        ))}

        {/* resize handles for single selection */}
        {singleSelected && editingElementId !== singleSelected.id && (
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

      {boardElements.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm text-center text-ink-soft">
            <p className="text-lg font-medium">This board is empty</p>
            <p className="mt-2 text-sm">
              Double-click anywhere to write a note, or drag an element in from
              the toolbar on the left.
            </p>
          </div>
        </div>
      )}

      <ZoomControls containerRef={containerRef} boardElements={boardElements} />
    </div>
  );
}

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
  const size = 8 / scale;
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
