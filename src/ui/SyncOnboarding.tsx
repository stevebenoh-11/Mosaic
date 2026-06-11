import { useEffect, useState } from 'react';
import { Cloud, X } from 'lucide-react';
import { getMeta, setMeta } from '@/db/schema';
import { useSyncStore } from '@/sync/status';
import { AuthError, connectDrive } from '@/sync';

/**
 * Friendly, one-time card suggesting Drive sync. One dismissal hides it for
 * good (meta flag). Hidden entirely when no client ID is configured.
 */
export function SyncOnboarding() {
  const { connected, clientIdPresent } = useSyncStore();
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getMeta<boolean>('sync:promptDismissed').then((v) =>
      setDismissed(v ?? false),
    );
  }, []);

  if (connected || !clientIdPresent || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    void setMeta('sync:promptDismissed', true);
  }

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      await connectDrive();
    } catch (err) {
      setError(
        err instanceof AuthError && err.code === 'popup-blocked'
          ? 'Popup blocked — connect from the account menu in your browser instead.'
          : 'Could not connect. You can try again from the account menu.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute bottom-16 left-3 z-30 w-72 rounded-xl border border-card-border bg-card p-3.5 shadow-card-drag sm:bottom-4 sm:left-16">
      <button
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-ink-soft hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Cloud className="h-4 w-4 text-accent" /> Sync across your devices
      </div>
      <p className="mt-1.5 pr-2 text-xs text-ink-soft">
        Connect Google Drive once and your boards, notes and images stay in
        sync everywhere — stored in a “Mosaic” folder in your own Drive.
      </p>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => void onConnect()}
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {busy ? 'Connecting…' : 'Connect Google Drive'}
        </button>
        <button
          onClick={dismiss}
          className="rounded-lg px-2 py-1.5 text-xs text-ink-soft hover:text-ink"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
