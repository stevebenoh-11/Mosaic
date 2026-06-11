import { useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useStore } from '@/store';
import { Sidebar } from '@/ui/Sidebar';
import { TopBar } from '@/ui/TopBar';
import { CanvasView } from '@/canvas/CanvasView';

function BoardPage() {
  const { boardId } = useParams<'boardId'>();
  const openBoard = useStore((s) => s.openBoard);
  const boardExists = useStore((s) => (boardId ? !!s.boards[boardId] : false));

  useEffect(() => {
    if (boardId && boardExists) void openBoard(boardId);
  }, [boardId, boardExists, openBoard]);

  if (!boardId || !boardExists) return <HomeRedirect />;
  return <CanvasView boardId={boardId} />;
}

function HomeRedirect() {
  const firstBoardId = useStore((s) => {
    const roots = Object.values(s.boards)
      .filter((b) => b.parentBoardId === null)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    return roots[0]?.id ?? null;
  });
  if (!firstBoardId) {
    return (
      <div className="flex flex-1 items-center justify-center text-ink-soft">
        No boards yet.
      </div>
    );
  }
  return <Navigate to={`/b/${firstBoardId}`} replace />;
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-ink-soft">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative flex min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/b/:boardId" element={<BoardPage />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
