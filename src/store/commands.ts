import type { Board, Element } from '@/db/types';

/**
 * Every mutation in Mosaic is a Command: a labeled list of entity Changes.
 * A Change is a uniform before/after snapshot of one entity, which makes
 * undo (swap before/after), persistence (write `after` or tombstone) and
 * sync dirty-tracking (outbox entry per touched entity) fall out of one shape.
 */
export type Change =
  | { entity: 'board'; id: string; before: Board | null; after: Board | null }
  | { entity: 'element'; id: string; before: Element | null; after: Element | null };

export interface Command {
  label: string;
  changes: Change[];
  /**
   * Consecutive commands with the same key merge into a single undo step
   * (used to batch text edits per editing session).
   */
  coalesceKey?: string;
}

export function invertChange(c: Change): Change {
  return { ...c, before: c.after, after: c.before } as Change;
}

export function invertCommand(cmd: Command): Command {
  return {
    label: cmd.label,
    changes: [...cmd.changes].reverse().map(invertChange),
  };
}

/** Merge `next` into `prev` in place: keep prev's `before`s, take next's `after`s. */
export function coalesceInto(prev: Command, next: Command): void {
  for (const c of next.changes) {
    const existing = prev.changes.find(
      (p) => p.entity === c.entity && p.id === c.id,
    );
    if (existing) {
      existing.after = c.after as never;
    } else {
      prev.changes.push(c);
    }
  }
}
