import { useEffect, useRef, useState } from 'react';
import {
  CircleUserRound,
  Cloud,
  History,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { useSyncStore } from '@/sync/status';
import {
  AuthError,
  connectDrive,
  disconnectDrive,
  syncNowManual,
} from '@/sync';

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { connected, account, clientIdPresent, lastSyncedAt, log, status } =
    useSyncStore();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // Capture phase: canvas elements stopPropagation on pointerdown, which
    // must not keep this menu open.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      await connectDrive();
    } catch (err) {
      if (err instanceof AuthError && err.code === 'popup-blocked') {
        setError(
          'The Google sign-in popup was blocked. Open Mosaic in your browser (not the installed app), connect there, then come back — sync picks up automatically.',
        );
      } else if (err instanceof AuthError && err.code === 'denied') {
        setError('Authorization was declined.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not connect.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    const sure = window.confirm(
      'Disconnect Google Drive?\n\nSync stops and Mosaic forgets this Google account on this device. All your boards and cards STAY on this device, and the Mosaic folder stays in your Drive.',
    );
    if (!sure) return;
    await disconnectDrive();
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-1 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
      >
        <CircleUserRound className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-72 rounded-lg border border-card-border bg-card p-3 shadow-card-drag">
          {!connected ? (
            <>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cloud className="h-4 w-4 text-accent" />
                Google Drive sync
              </div>
              {clientIdPresent ? (
                <>
                  <p className="mt-2 text-xs text-ink-soft">
                    Keep your boards in sync across every device. Mosaic stores
                    its data in a visible “Mosaic” folder in your own Drive and
                    can only see files it created.
                  </p>
                  <button
                    onClick={() => void onConnect()}
                    disabled={busy}
                    className="mt-3 w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {busy ? 'Connecting…' : 'Connect Google Drive'}
                  </button>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-soft">
                  Add a Google client ID to enable sync: put
                  <code className="mx-1 rounded bg-panel-border px-1">
                    VITE_GOOGLE_CLIENT_ID
                  </code>
                  in <code className="rounded bg-panel-border px-1">.env</code>{' '}
                  — see SETUP_GOOGLE.md (about 5 minutes).
                </p>
              )}
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <CircleUserRound className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {account?.name || 'Google account'}
                  </div>
                  <div className="truncate text-xs text-ink-soft">
                    {account?.email}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-ink-soft">
                {status === 'paused'
                  ? 'Sync paused — reconnect to resume. Edits keep queueing locally.'
                  : lastSyncedAt
                    ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
                    : 'Not synced yet'}
              </div>
              <div className="mt-3 flex flex-col gap-1">
                <button
                  onClick={() => void syncNowManual()}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel-border/40"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-ink-soft" /> Sync now
                </button>
                <button
                  onClick={() => setShowLog((v) => !v)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel-border/40"
                >
                  <History className="h-3.5 w-3.5 text-ink-soft" /> Sync log
                  {log.length > 0 && (
                    <span className="ml-auto rounded-full bg-panel-border px-1.5 text-[10px] text-ink-soft">
                      {log.length}
                    </span>
                  )}
                </button>
                {showLog && (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-card-border bg-panel p-2 text-[11px] text-ink-soft">
                    {log.length === 0 && <div>No conflicts resolved yet.</div>}
                    {log.slice(0, 20).map((entry, i) => (
                      <div key={i} className="mb-1">
                        <span className="text-ink">
                          {new Date(entry.at).toLocaleTimeString()}
                        </span>{' '}
                        — {entry.resolution}{' '}
                        <span className="opacity-60">
                          ({entry.entityId.slice(0, 8)})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => void onDisconnect()}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-3.5 w-3.5" /> Disconnect…
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
