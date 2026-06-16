import { Bell, Check, Loader2, Menu, Moon, Sun } from 'lucide-react';
import { useStore } from '@/store';
import { useActivityStore } from '@/store/activityStore';
import { useUiStore } from './uiStore';
import { Breadcrumbs } from './Breadcrumbs';
import { AccountMenu } from './AccountMenu';
import { ExportMenu } from './ExportMenu';
import { SyncStatusPill } from './SyncStatusPill';

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

function ActivityBell() {
  const setActivityOpen = useUiStore((s) => s.setActivityOpen);
  const unseen = useActivityStore(
    (s) => s.entries.filter((e) => e.at > s.lastSeenAt).length,
  );
  return (
    <button
      aria-label={`Activity${unseen > 0 ? ` (${unseen} new)` : ''}`}
      title="Activity"
      onClick={() => setActivityOpen(true)}
      className="relative rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
    >
      <Bell className="h-4 w-4" />
      {unseen > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
          {unseen > 9 ? '9+' : unseen}
        </span>
      )}
    </button>
  );
}

function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <button
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      onClick={toggleTheme}
      className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
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
      <SyncStatusPill />
      <div className="flex-1" />
      <SaveIndicator />
      <ActivityBell />
      <ThemeToggle />
      <ExportMenu />
      <AccountMenu />
    </header>
  );
}
