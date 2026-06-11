import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { useStore } from '@/store';
import type { BoardLinkContent, Element } from '@/db/types';

export const BoardLinkCard = memo(function BoardLinkCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as BoardLinkContent;
  const board = useStore((s) => s.boards[c.boardId]);
  const navigate = useNavigate();

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-3"
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
        Board
      </div>
    </div>
  );
});
