import { useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useStore } from '@/store';
import { Sidebar } from '@/ui/Sidebar';
import { TopBar } from '@/ui/TopBar';
import { Toolbar } from '@/ui/Toolbar';
import { ShortcutsPanel } from '@/ui/ShortcutsPanel';
import { CommandPalette } from '@/ui/CommandPalette';
import { QuickCapture } from '@/ui/QuickCapture';
import { useUiStore } from '@/ui/uiStore';
import { CanvasView } from '@/canvas/CanvasView';

function BoardPage() {
  const { boardId } = useParams<'boardId'>();
  const openBoard = useStore((s) => s.openBoard);
  const boardExists = useStore((s) => (boardId ? !!s.boards[boardId] : false));

  useEffect(() => {
    if (boardId && boardExists) void openBoard(boardId);
  }, [boardId, boardExists, openBoard]);

  if (!boardId || !boardExists) return <HomeRedirect />;
  return (
    <>
      <CanvasView boardId={boardId} />
      <Toolbar boardId={boardId} />
      <QuickCapture boardId={boardId} />
      <ShortcutsPanel />
    </>
  );
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

  // Best-effort flush of pending writes when the tab hides or unloads.
  useEffect(() => {
    const flush = () => void useStore.getState().flushNow();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  // Global Ctrl/Cmd+K opens the search palette.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setPaletteOpen(!ui.paletteOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
        <CommandPalette />
      </div>
    </div>
  );
}
