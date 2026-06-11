import { Check, CloudOff, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useSyncStore } from '@/sync/status';
import { reconnectDrive } from '@/sync';

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function SyncStatusPill() {
  const { status, connected, lastSyncedAt } = useSyncStore();
  if (!connected || status === 'disabled') return null;

  const title = lastSyncedAt ? `Last synced ${timeAgo(lastSyncedAt)}` : 'Not synced yet';

  if (status === 'paused') {
    return (
      <button
        onClick={() => void reconnectDrive().catch(() => undefined)}
        title="Sync is paused — click to reconnect Google Drive"
        className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-700 hover:bg-amber-100"
      >
        <CloudOff className="h-3 w-3" /> Sync paused — Reconnect
      </button>
    );
  }

  const variants = {
    synced: {
      icon: <Check className="h-3 w-3" />,
      label: 'Synced',
      cls: 'border-card-border bg-card text-ink-soft',
    },
    syncing: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: 'Syncing…',
      cls: 'border-card-border bg-card text-ink-soft',
    },
    offline: {
      icon: <WifiOff className="h-3 w-3" />,
      label: 'Offline',
      cls: 'border-card-border bg-panel text-ink-soft',
    },
  } as const;
  const v = variants[status as keyof typeof variants] ?? {
    icon: <RefreshCw className="h-3 w-3" />,
    label: status,
    cls: 'border-card-border bg-card text-ink-soft',
  };

  return (
    <span
      data-testid="sync-pill"
      title={title}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${v.cls}`}
    >
      {v.icon} {v.label}
    </span>
  );
}
