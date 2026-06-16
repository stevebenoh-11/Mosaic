import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, LayoutGrid, Plus, Square, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import { db } from '@/db/schema';
import { newId } from '@/db/ids';
import type { Board } from '@/db/types';
import { buildDeleteBoardCmd, renameBoardCmd } from '@/store/boardCommands';

interface Counts {
  cards: number;
  documents: number;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function BoardOverview() {
  const boards = useStore((s) => s.boards);
  const execute = useStore((s) => s.execute);
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Record<string, Counts>>({});

  const ordered = useMemo(
    () => Object.values(boards).sort((a, b) => b.updatedAt - a.updatedAt),
    [boards],
  );

  // Element counts live in Dexie; recompute when the board set changes.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await useStore.getState().flushNow();
      const rows = await db.elements.toArray();
      const map: Record<string, Counts> = {};
      for (const el of rows) {
        const c = (map[el.boardId] ??= { cards: 0, documents: 0 });
        if (el.type === 'document') {
          c.documents++;
        } else if (el.type !== 'line' && el.type !== 'comment' && el.type !== 'drawing') {
          c.cards++;
        }
      }
      if (alive) setCounts(map);
    })();
    return () => {
      alive = false;
    };
  }, [boards]);

  function createBoard() {
    const now = Date.now();
    const id = newId();
    const rootCount = Object.values(boards).filter((b) => b.parentBoardId === null).length;
    const board: Board = {
      id,
      title: 'Untitled board',
      parentBoardId: null,
      sortIndex: rootCount,
      createdAt: now,
      updatedAt: now,
    };
    execute({ label: 'Create board', changes: [{ entity: 'board', id, before: null, after: board }] });
    navigate(`/b/${id}`);
  }

  function rename(board: Board) {
    const title = window.prompt('Board name', board.title);
    if (title !== null) execute(renameBoardCmd(board, title));
  }

  async function remove(board: Board) {
    const sure = window.confirm(
      `Delete "${board.title || 'Untitled board'}" and everything on it? Sub-boards are kept and move up a level.`,
    );
    if (!sure) return;
    const cmd = await buildDeleteBoardCmd(board, useStore.getState().boards);
    execute(cmd);
  }

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold">All boards</h1>
          <button
            onClick={createBoard}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New board
          </button>
        </div>

        {ordered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-card-border p-12 text-center text-ink-soft">
            No boards yet. Create your first board to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((board) => {
              const c = counts[board.id] ?? { cards: 0, documents: 0 };
              const nested = Object.values(boards).filter((b) => b.parentBoardId === board.id).length;
              const parent = board.parentBoardId ? boards[board.parentBoardId] : null;
              return (
                <div
                  key={board.id}
                  className="group/card flex cursor-pointer flex-col rounded-xl border border-card-border bg-card p-4 shadow-card transition-shadow hover:shadow-card-drag"
                  onClick={() => navigate(`/b/${board.id}`)}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                        <LayoutGrid className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{board.title || 'Untitled board'}</div>
                        {parent && (
                          <div className="truncate text-[11px] text-ink-soft">in {parent.title || 'Untitled'}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
                      <button
                        aria-label="Rename board"
                        onClick={(e) => {
                          e.stopPropagation();
                          rename(board);
                        }}
                        className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
                      >
                        <Square className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Delete board"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(board);
                        }}
                        className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span>{c.cards} {c.cards === 1 ? 'card' : 'cards'}</span>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" /> {c.documents}
                    </span>
                    <span>{nested} nested</span>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-soft/80">
                    Updated {formatDate(board.updatedAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
