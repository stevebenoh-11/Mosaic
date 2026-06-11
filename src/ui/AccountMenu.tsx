import { useEffect, useRef, useState } from 'react';
import { CircleUserRound, Cloud } from 'lucide-react';

/**
 * Account menu placeholder — Google Drive sync arrives in M6.
 * The menu shape (account row, sync actions) is already laid out here.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

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
        <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-card-border bg-card p-3 shadow-card-drag">
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <Cloud className="h-4 w-4" />
            <span>Not connected</span>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Google Drive sync lets you use Mosaic on every device. Coming up in
            this build — your data stays on this device until then.
          </p>
        </div>
      )}
    </div>
  );
}
