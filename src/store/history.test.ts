import { describe, expect, it } from 'vitest';
import type { Board } from '@/db/types';
import { invertCommand, type Command } from './commands';
import { History } from './history';

function board(id: string, title: string): Board {
  return {
    id,
    title,
    parentBoardId: null,
    sortIndex: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function renameCmd(id: string, from: string, to: string, key?: string): Command {
  return {
    label: 'Rename board',
    coalesceKey: key,
    changes: [
      { entity: 'board', id, before: board(id, from), after: board(id, to) },
    ],
  };
}

describe('invertCommand', () => {
  it('swaps before/after and reverses order', () => {
    const cmd: Command = {
      label: 'two changes',
      changes: [
        { entity: 'board', id: 'a', before: null, after: board('a', 'A') },
        { entity: 'board', id: 'b', before: board('b', 'B'), after: null },
      ],
    };
    const inv = invertCommand(cmd);
    expect(inv.changes[0]).toMatchObject({ id: 'b', before: null });
    expect(inv.changes[0]?.after).toMatchObject({ title: 'B' });
    expect(inv.changes[1]).toMatchObject({ id: 'a', after: null });
  });
});

describe('History', () => {
  it('undo/redo round-trips', () => {
    const h = new History();
    h.record(renameCmd('a', 'One', 'Two'));
    expect(h.canUndo).toBe(true);
    const undone = h.popUndo();
    expect(undone?.label).toBe('Rename board');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    const redone = h.popRedo();
    expect(redone).toBe(undone);
    expect(h.canRedo).toBe(false);
  });

  it('coalesces consecutive commands with the same key into one undo step', () => {
    const h = new History();
    h.record(renameCmd('a', 'One', 'Tw', 'edit:a'));
    h.record(renameCmd('a', 'Tw', 'Two', 'edit:a'));
    const cmd = h.popUndo();
    expect(h.canUndo).toBe(false);
    const change = cmd?.changes[0];
    expect(change?.before).toMatchObject({ title: 'One' });
    expect(change?.after).toMatchObject({ title: 'Two' });
  });

  it('breakCoalescing starts a new undo step', () => {
    const h = new History();
    h.record(renameCmd('a', 'One', 'Two', 'edit:a'));
    h.breakCoalescing();
    h.record(renameCmd('a', 'Two', 'Three', 'edit:a'));
    h.popUndo();
    expect(h.canUndo).toBe(true);
  });

  it('recording clears the redo stack', () => {
    const h = new History();
    h.record(renameCmd('a', 'One', 'Two'));
    h.popUndo();
    expect(h.canRedo).toBe(true);
    h.record(renameCmd('a', 'One', 'Other'));
    expect(h.canRedo).toBe(false);
  });
});
