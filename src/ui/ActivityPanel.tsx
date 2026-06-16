import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  LayoutGrid,
  MessageCircle,
  Move,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useActivityStore, type ActivityKind } from '@/store/activityStore';
import { useStore } from '@/store';
import { useUiStore } from './uiStore';
import { relativeTime } from '@/elements/comment/CommentPin';

const KIND_ICON: Record<ActivityKind, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  move: Move,
  comment: MessageCircle,
  board: LayoutGrid,
  other: Activity,
};

export function ActivityPanel() {
  const open = useUiStore((s) => s.activityOpen);
  const setOpen = useUiStore((s) => s.setActivityOpen);
  const entries = useActivityStore((s) => s.entries);
  const lastSeenAt = useActivityStore((s) => s.lastSeenAt);
  const markAllSeen = useActivityStore((s) => s.markAllSeen);
  const account = useStore.getState().deviceId;
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} aria-hidden />
      <aside className="safe-area absolute right-0 top-0 flex h-full w-80 max-w-[88vw] flex-col border-l border-panel-border bg-panel shadow-card-drag">
        <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <span className="text-sm font-semibold">Activity</span>
          <div className="flex items-center gap-1">
            <button
              onClick={markAllSeen}
              className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-panel-border/60 hover:text-ink"
            >
              Mark all as seen
            </button>
            <button
              aria-label="Close activity"
              onClick={() => setOpen(false)}
              className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Online now — structure for future real-time presence. */}
        <div className="border-b border-panel-border px-4 py-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Online now
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="truncate">You{account ? ` · ${account.slice(0, 6)}` : ''}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-soft">No activity yet.</div>
          ) : (
            <ul className="divide-y divide-panel-border/60">
              {entries.map((e) => {
                const Icon = KIND_ICON[e.kind];
                const unseen = e.at > lastSeenAt;
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => {
                        if (e.boardId) navigate(`/b/${e.boardId}`);
                        setOpen(false);
                      }}
                      className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-panel-border/40"
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          unseen ? 'bg-accent-soft text-accent' : 'bg-panel-border/60 text-ink-soft'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{e.label}</span>
                        <span className="block truncate text-[11px] text-ink-soft">
                          {e.boardTitle ? `${e.boardTitle} · ` : ''}
                          {relativeTime(e.at)}
                        </span>
                      </span>
                      {unseen && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
