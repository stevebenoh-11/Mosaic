import { create } from 'zustand';
import type { Board } from '@/db/types';
import type { Command } from './commands';

export type ActivityKind =
  | 'create'
  | 'update'
  | 'delete'
  | 'move'
  | 'comment'
  | 'board'
  | 'other';

export interface ActivityEntry {
  id: string;
  at: number;
  /** Human-readable action, e.g. "Create note". */
  label: string;
  kind: ActivityKind;
  boardId: string | null;
  boardTitle?: string;
  /** Lets a coalescing edit/move session collapse to one entry. */
  coalesceKey?: string;
}

const STORE_KEY = 'mosaic:activity';
const MAX_ENTRIES = 200;
let nextId = 1;

function load(): { entries: ActivityEntry[]; lastSeenAt: number } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { entries: ActivityEntry[]; lastSeenAt: number };
      if (Array.isArray(parsed.entries)) return parsed;
    }
  } catch {
    /* ignore — start empty */
  }
  return { entries: [], lastSeenAt: 0 };
}

function persist(entries: ActivityEntry[], lastSeenAt: number): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ entries, lastSeenAt }));
  } catch {
    /* storage full / blocked — activity just won't persist */
  }
}

interface ActivityState {
  entries: ActivityEntry[];
  lastSeenAt: number;
  push(entry: Omit<ActivityEntry, 'id'>): void;
  markAllSeen(): void;
  clear(): void;
}

const initial = load();

export const useActivityStore = create<ActivityState>((set, get) => ({
  entries: initial.entries,
  lastSeenAt: initial.lastSeenAt,
  push(entry) {
    const entries = [...get().entries];
    const last = entries[0];
    // Collapse a coalescing session (text edit, drag) into one entry.
    if (entry.coalesceKey && last && last.coalesceKey === entry.coalesceKey) {
      entries[0] = { ...last, at: entry.at, label: entry.label };
    } else {
      entries.unshift({ ...entry, id: `a${nextId++}` });
    }
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    persist(entries, get().lastSeenAt);
    set({ entries });
  },
  markAllSeen() {
    const lastSeenAt = Date.now();
    persist(get().entries, lastSeenAt);
    set({ lastSeenAt });
  },
  clear() {
    persist([], Date.now());
    set({ entries: [], lastSeenAt: Date.now() });
  },
}));

/** Derive a kind from a command's changes (created/deleted/updated). */
function kindOf(cmd: Command): ActivityKind {
  const label = cmd.label.toLowerCase();
  if (label.includes('comment') || label.includes('reply')) return 'comment';
  if (label.startsWith('move') || label === 'resize' || label === 'reorder') return 'move';
  const hasBoard = cmd.changes.some((c) => c.entity === 'board');
  const created = cmd.changes.some((c) => c.before === null && c.after !== null);
  const deleted = cmd.changes.some((c) => c.before !== null && c.after === null);
  if (hasBoard && (label.includes('board') || created || deleted)) return 'board';
  if (created) return 'create';
  if (deleted) return 'delete';
  return 'update';
}

/**
 * Record a user command in the activity feed. Skips no-op commands and the
 * viewport/selection churn (those never become commands anyway).
 */
export function logCommand(cmd: Command, boards: Record<string, Board>): void {
  if (cmd.changes.length === 0) return;
  const first = cmd.changes[0]!;
  const boardId =
    first.entity === 'board'
      ? first.id
      : ((first.after ?? first.before)?.boardId ?? null);
  const boardTitle = boardId ? boards[boardId]?.title : undefined;
  useActivityStore.getState().push({
    at: Date.now(),
    label: cmd.label,
    kind: kindOf(cmd),
    boardId,
    boardTitle,
    coalesceKey: cmd.coalesceKey,
  });
}
