import { Check, Loader2 } from 'lucide-react';
import { useStore } from '@/store';
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
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-panel-border bg-panel px-3">
      <Breadcrumbs />
      <div className="flex-1" />
      <SaveIndicator />
      <ExportMenu />
      <AccountMenu />
    </header>
  );
}
