import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { applyTheme, useUiStore } from './ui/uiStore';
import { useStore } from './store';
import './index.css';

// Apply the saved theme before first paint to avoid a light-mode flash.
applyTheme(useUiStore.getState().theme);

// No service worker under file:// (packaged Electron) — registration would
// reject and the app runs fully offline there anyway.
if (window.location.protocol !== 'file:') {
  try {
    registerSW({ immediate: true });
  } catch (e) {
    console.warn('Service worker registration failed:', e);
  }
}

// Last-resort logging so background failures (sync, persistence) surface in
// diagnostics instead of dying as silent unhandled rejections.
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  e.preventDefault();
});

// Exposed for e2e tests and debugging (read-only usage expected).
declare global {
  interface Window {
    __mosaicStore: typeof useStore;
    __mosaicSeedStress: (count?: number) => Promise<string>;
  }
}
window.__mosaicStore = useStore;

// Dev/e2e helper: seed a large stress board and return its id.
window.__mosaicSeedStress = async (count = 1500) => {
  const { db } = await import('./db/schema');
  const { newId } = await import('./db/ids');
  const now = Date.now();
  const boardId = newId();
  await db.boards.add({
    id: boardId,
    title: `Stress ${count}`,
    parentBoardId: null,
    sortIndex: 999,
    createdAt: now,
    updatedAt: now,
  });
  const cols = Math.ceil(Math.sqrt(count * 1.5));
  const elements = Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const swatch = i % 7 === 0;
    return {
      id: newId(),
      boardId,
      type: swatch ? ('swatch' as const) : ('note' as const),
      x: col * 260,
      y: row * 160,
      w: swatch ? 140 : 200,
      h: swatch ? 100 : 90,
      zIndex: i + 1,
      parentColumnId: null,
      sortIndex: 0,
      content: swatch
        ? { hex: '#6C5CE7', label: `S${i}` }
        : {
            doc: {
              type: 'doc' as const,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: `Stress card #${i}` }],
                },
              ],
            },
          },
      style: {},
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.elements.bulkAdd(elements);
  return boardId;
};

// Packaged Electron loads the app from file://, where path-based routing
// can't work — fall back to hash-based routing there.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Router>
        <App />
      </Router>
    </ErrorBoundary>
  </React.StrictMode>,
);
