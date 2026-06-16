import { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { useStore } from '@/store';
import { db } from '@/db/schema';
import type { BoardLinkContent, Element } from '@/db/types';

export const BoardLinkCard = memo(function BoardLinkCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as BoardLinkContent;
  const boards = useStore((s) => s.boards);
  const board = boards[c.boardId];
  const navigate = useNavigate();

  const nested = useMemo(
    () => Object.values(boards).filter((b) => b.parentBoardId === c.boardId).length,
    [boards, c.boardId],
  );
  const [cardCount, setCardCount] = useState<number | null>(null);

  // Card count lives in Dexie (the target board's elements usually aren't in
  // memory). Re-count when the board id changes; the card remounts on nav.
  useEffect(() => {
    let alive = true;
    db.elements
      .where('boardId')
      .equals(c.boardId)
      .count()
      .then((n) => alive && setCardCount(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [c.boardId]);

  const parts: string[] = [];
  if (cardCount !== null) parts.push(`${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`);
  if (nested > 0) parts.push(`${nested} ${nested === 1 ? 'board' : 'boards'}`);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-1.5 p-3"
      onDoubleClick={() => {
        if (board) navigate(`/b/${board.id}`);
      }}
      title="Double-click to open board"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <LayoutGrid className="h-5 w-5" />
      </div>
      <div className="w-full truncate text-center text-sm font-medium">
        {board?.title ?? 'Missing board'}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-ink-soft">
        {parts.length > 0 ? parts.join(' · ') : 'Board'}
      </div>
    </div>
  );
});
