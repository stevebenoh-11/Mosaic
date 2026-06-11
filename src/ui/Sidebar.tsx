import { useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useStore } from '@/store';
import { newId } from '@/db/ids';
import type { Board } from '@/db/types';
import { Logo } from './Logo';

function childrenOf(boards: Record<string, Board>, parentId: string | null) {
  return Object.values(boards)
    .filter((b) => b.parentBoardId === parentId)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt);
}

function BoardNode({ board, depth }: { board: Board; depth: number }) {
  const boards = useStore((s) => s.boards);
  const children = childrenOf(boards, board.id);
  return (
    <li>
      <NavLink
        to={`/b/${board.id}`}
        className={({ isActive }) =>
          `block truncate rounded-md px-2 py-1.5 text-sm ${
            isActive
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-ink hover:bg-panel-border/60'
          }`
        }
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {board.title || 'Untitled board'}
      </NavLink>
      {children.length > 0 && (
        <ul>
          {children.map((c) => (
            <BoardNode key={c.id} board={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Sidebar() {
  const boards = useStore((s) => s.boards);
  const execute = useStore((s) => s.execute);
  const navigate = useNavigate();
  const roots = useMemo(() => childrenOf(boards, null), [boards]);

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
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-panel-border bg-panel sm:flex">
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
            <BoardNode key={b.id} board={b} depth={0} />
          ))}
        </ul>
      </nav>
    </aside>
  );
}
