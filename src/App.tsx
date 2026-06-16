import { useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useStore } from '@/store';
import { Sidebar } from '@/ui/Sidebar';
import { TopBar } from '@/ui/TopBar';
import { Toolbar } from '@/ui/Toolbar';
import { ShortcutsPanel } from '@/ui/ShortcutsPanel';
import { CommandPalette } from '@/ui/CommandPalette';
import { QuickCapture } from '@/ui/QuickCapture';
import { SyncOnboarding } from '@/ui/SyncOnboarding';
import { initSync } from '@/sync';
import { useUiStore } from '@/ui/uiStore';
import { CanvasView } from '@/canvas/CanvasView';
import { DocumentModal } from '@/elements/document/DocumentModal';
import { ActivityPanel } from '@/ui/ActivityPanel';
import { QuickNotesPanel } from '@/ui/QuickNotesPanel';
import { BoardOverview } from '@/ui/BoardOverview';

function BoardPage() {
  const { boardId } = useParams<'boardId'>();
  const openBoard = useStore((s) => s.openBoard);
  const boardExists = useStore((s) => (boardId ? !!s.boards[boardId] : false));

  useEffect(() => {
    if (boardId && boardExists) {
      openBoard(boardId).catch((e) =>
        console.error('Failed to open board:', e),
      );
    }
  }, [boardId, boardExists, openBoard]);

  if (!boardId || !boardExists) return <HomeRedirect />;
  return (
    <>
      <CanvasView boardId={boardId} />
      <Toolbar boardId={boardId} />
      <QuickCapture boardId={boardId} />
      <SyncOnboarding />
      <ShortcutsPanel />
      <DocumentModal />
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
  const initError = useStore((s) => s.initError);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init()
      .then(() => initSync())
      .catch((e) => console.error('Startup failed:', e));
  }, [init]);

  // Best-effort flush of pending writes when the tab hides or unloads.
  useEffect(() => {
    const flush = () =>
      useStore
        .getState()
        .flushNow()
        .catch((e) => console.error('Flush on hide failed:', e));
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

  if (initError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-lg font-semibold">Can&apos;t access local storage</div>
        <div className="max-w-md text-sm text-ink-soft">{initError}</div>
        <button
          type="button"
          className="mt-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="safe-area flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative flex min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/boards" element={<BoardOverview />} />
            <Route path="/b/:boardId" element={<BoardPage />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </main>
        <CommandPalette />
      </div>
      <ActivityPanel />
      <QuickNotesPanel />
    </div>
  );
}
