import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import { newId } from '@/db/ids';
import type { Board } from '@/db/types';
import {
  buildDeleteBoardCmd,
  isDescendant,
  renameBoardCmd,
  reorderBoardCmd,
} from '@/store/boardCommands';
import { Logo } from './Logo';
import { useUiStore } from './uiStore';

function childrenOf(boards: Record<string, Board>, parentId: string | null) {
  return Object.values(boards)
    .filter((b) => b.parentBoardId === parentId)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt);
}

interface DragState {
  boardId: string;
  started: boolean;
  startX: number;
  startY: number;
  /** Current drop hint. */
  over: { boardId: string; mode: 'before' | 'after' | 'inside' } | null;
  pointer: { x: number; y: number };
}

function BoardNode({
  board,
  depth,
  drag,
  renamingId,
  setRenamingId,
  onRowPointerDown,
}: {
  board: Board;
  depth: number;
  drag: DragState | null;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  onRowPointerDown: (e: React.PointerEvent, board: Board) => void;
}) {
  const boards = useStore((s) => s.boards);
  const execute = useStore((s) => s.execute);
  const navigate = useNavigate();
  const currentBoardId = useStore((s) => s.currentBoardId);
  const children = childrenOf(boards, board.id);
  const renaming = renamingId === board.id;
  const [draft, setDraft] = useState(board.title);

  useEffect(() => {
    if (renaming) setDraft(board.title);
  }, [renaming, board.title]);

  const hint = drag?.over?.boardId === board.id ? drag.over.mode : null;
  const isDragSource = drag?.started && drag.boardId === board.id;

  async function remove() {
    const fresh = useStore.getState().boards[board.id];
    if (!fresh) return;
    const sure = window.confirm(
      `Delete "${fresh.title || 'Untitled board'}" and everything on it? Sub-boards are kept and move up a level.`,
    );
    if (!sure) return;
    const cmd = await buildDeleteBoardCmd(fresh, useStore.getState().boards);
    execute(cmd);
    if (currentBoardId === board.id) navigate('/');
  }

  return (
    <li className={isDragSource ? 'opacity-40' : ''}>
      <div className="relative">
        {hint === 'before' && <DropHint depth={depth} pos="top" />}
        {hint === 'after' && <DropHint depth={depth} pos="bottom" />}
        <div
          data-board-nav-id={board.id}
          className={`group/row relative rounded-md ${hint === 'inside' ? 'ring-2 ring-accent/70' : ''}`}
          onPointerDown={(e) => onRowPointerDown(e, board)}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenamingId(board.id);
          }}
        >
          {renaming ? (
            <input
              autoFocus
              value={draft}
              aria-label="Board name"
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setDraft(e.target.value);
                const fresh = useStore.getState().boards[board.id];
                if (fresh) execute(renameBoardCmd(fresh, e.target.value));
              }}
              onBlur={() => setRenamingId(null)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') setRenamingId(null);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full rounded-md border border-accent bg-card px-2 py-1 text-sm outline-none"
              style={{ marginLeft: `${depth * 14}px`, width: `calc(100% - ${depth * 14}px)` }}
            />
          ) : (
            <NavLink
              to={`/b/${board.id}`}
              draggable={false}
              onClick={(e) => {
                if (drag?.started) e.preventDefault();
                else useUiStore.getState().setSidebarOpen(false);
              }}
              className={({ isActive }) =>
                `block select-none truncate rounded-md px-2 py-1.5 pr-7 text-sm ${
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink hover:bg-panel-border/60'
                }`
              }
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {board.title || 'Untitled board'}
            </NavLink>
          )}
          {!renaming && (
            <button
              aria-label={`Delete board ${board.title || 'Untitled board'}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void remove()}
              // Always visible on touch (no hover); hover-reveal on desktop.
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-soft opacity-100 hover:text-ink sm:opacity-0 sm:group-hover/row:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((c) => (
            <BoardNode
              key={c.id}
              board={c}
              depth={depth + 1}
              drag={drag}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              onRowPointerDown={onRowPointerDown}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function DropHint({ depth, pos }: { depth: number; pos: 'top' | 'bottom' }) {
  return (
    <div
      className={`absolute left-0 right-0 z-10 h-0.5 rounded bg-accent ${pos === 'top' ? '-top-px' : '-bottom-px'}`}
      style={{ marginLeft: `${8 + depth * 14}px` }}
    />
  );
}

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-panel-border bg-panel sm:block">
        <SidebarContent />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="safe-area absolute left-0 top-0 h-full w-64 border-r border-panel-border bg-panel shadow-card-drag">
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}

function SidebarContent() {
  const boards = useStore((s) => s.boards);
  const execute = useStore((s) => s.execute);
  const navigate = useNavigate();
  const roots = useMemo(() => childrenOf(boards, null), [boards]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  function createBoard() {
    const now = Date.now();
    const id = newId();
    const board: Board = {
      id,
      title: 'Untitled board',
      parentBoardId: null,
      sortIndex: roots.length,
      createdAt: now,
      updatedAt: now,
    };
    execute({
      label: 'Create board',
      changes: [{ entity: 'board', id, before: null, after: board }],
    });
    navigate(`/b/${id}`);
    setRenamingId(id);
  }

  function onRowPointerDown(e: React.PointerEvent, board: Board) {
    if (e.button !== 0 || renamingId) return;
    const init: DragState = {
      boardId: board.id,
      started: false,
      startX: e.clientX,
      startY: e.clientY,
      over: null,
      pointer: { x: e.clientX, y: e.clientY },
    };
    dragRef.current = init;
    setDrag(init);
  }

  useEffect(() => {
    if (!drag) return;

    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
        d.started = true;
      }
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
        ?.closest('[data-board-nav-id]');
      let over: DragState['over'] = null;
      if (row) {
        const overId = row.getAttribute('data-board-nav-id')!;
        const allBoards = useStore.getState().boards;
        // Can't drop a board onto itself or its descendants.
        if (!isDescendant(allBoards, d.boardId, overId)) {
          const rect = row.getBoundingClientRect();
          const t = (e.clientY - rect.top) / rect.height;
          over = {
            boardId: overId,
            mode: t < 0.3 ? 'before' : t > 0.7 ? 'after' : 'inside',
          };
        }
      }
      const next = { ...d, over, pointer: { x: e.clientX, y: e.clientY } };
      dragRef.current = next;
      setDrag(next);
    }

    function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d?.started || !d.over) return;
      const state = useStore.getState();
      const moved = state.boards[d.boardId];
      const target = state.boards[d.over.boardId];
      if (!moved || !target) return;

      if (d.over.mode === 'inside') {
        const siblings = childrenOf(state.boards, target.id).map((b) => b.id);
        execute(
          reorderBoardCmd(moved, target.id, [...siblings.filter((id) => id !== moved.id), moved.id], state.boards),
        );
      } else {
        const parentId = target.parentBoardId;
        const siblings = childrenOf(state.boards, parentId)
          .map((b) => b.id)
          .filter((id) => id !== moved.id);
        const idx = siblings.indexOf(target.id);
        const insertAt = d.over.mode === 'before' ? idx : idx + 1;
        siblings.splice(insertAt, 0, moved.id);
        execute(reorderBoardCmd(moved, parentId, siblings, state.boards));
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dragRef.current = null;
        setDrag(null);
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag !== null, execute]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <Logo className="h-6 w-6" />
        <span className="text-[15px] font-semibold tracking-tight">Mosaic</span>
      </div>
      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          Boards
        </span>
        <button
          onClick={createBoard}
          aria-label="New board"
          className="rounded p-1 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ul>
          {roots.map((b) => (
            <BoardNode
              key={b.id}
              board={b}
              depth={0}
              drag={drag?.started ? drag : null}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              onRowPointerDown={onRowPointerDown}
            />
          ))}
        </ul>
      </nav>
      {drag?.started && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-accent/60 bg-card px-2 py-1 text-xs shadow-card-drag"
          style={{ left: drag.pointer.x + 10, top: drag.pointer.y + 6 }}
        >
          {boards[drag.boardId]?.title || 'Untitled board'}
        </div>
      )}
    </div>
  );
}
