import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useStore } from '@/store';
import type { Board } from '@/db/types';

export function Breadcrumbs() {
  const boards = useStore((s) => s.boards);
  const currentBoardId = useStore((s) => s.currentBoardId);

  const chain: Board[] = [];
  let cursor = currentBoardId ? boards[currentBoardId] : undefined;
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentBoardId ? boards[cursor.parentBoardId] : undefined;
  }

  if (chain.length === 0) return <div className="text-sm text-ink-soft" />;

  return (
    <nav aria-label="Breadcrumbs" className="flex min-w-0 items-center gap-1">
      {chain.map((b, i) => {
        const isLast = i === chain.length - 1;
        return (
          <span key={b.id} className="flex min-w-0 items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
            )}
            {isLast ? (
              <span className="truncate text-sm font-medium">
                {b.title || 'Untitled board'}
              </span>
            ) : (
              <Link
                to={`/b/${b.id}`}
                className="truncate text-sm text-ink-soft hover:text-ink"
              >
                {b.title || 'Untitled board'}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
