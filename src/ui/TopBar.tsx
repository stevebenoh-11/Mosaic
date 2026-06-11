import { Check, Loader2, Menu } from 'lucide-react';
import { useStore } from '@/store';
import { useUiStore } from './uiStore';
import { Breadcrumbs } from './Breadcrumbs';
import { AccountMenu } from './AccountMenu';
import { ExportMenu } from './ExportMenu';

function SaveIndicator() {
  const saveState = useStore((s) => s.saveState);
  return (
    <span
      className="flex items-center gap-1 text-xs text-ink-soft"
      aria-live="polite"
    >
      {saveState === 'saving' ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </>
      ) : (
        <>
          <Check className="h-3 w-3" /> All changes saved
        </>
      )}
    </span>
  );
}

export function TopBar() {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-panel-border bg-panel px-3">
      <button
        aria-label="Open boards menu"
        onClick={() => setSidebarOpen(true)}
        className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink sm:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>
      <Breadcrumbs />
      <div className="flex-1" />
      <SaveIndicator />
      <ExportMenu />
      <AccountMenu />
    </header>
  );
}
