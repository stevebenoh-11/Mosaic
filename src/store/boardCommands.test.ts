import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Board, Element } from '@/db/types';
import { buildDeleteBoardCmd } from './boardCommands';

function board(id: string, parentBoardId: string | null): Board {
  return { id, title: id, parentBoardId, sortIndex: 0, createdAt: 0, updatedAt: 0 };
}

function el(id: string, boardId: string, extra: Partial<Element> = {}): Element {
  return {
    id, boardId, type: 'note', x: 0, y: 0, w: 100, h: 60, zIndex: 1,
    parentColumnId: null, sortIndex: 0, content: { doc: { type: 'doc' } },
    style: {}, createdAt: 0, updatedAt: 0, ...extra,
  };
}

afterEach(async () => {
  await Promise.all([db.elements.clear(), db.boards.clear()]);
});

describe('buildDeleteBoardCmd', () => {
  it('deletes board-link cards on other boards that point to the deleted board', async () => {
    // Board B (to delete) sits under root A; a board-link card to B lives on A.
    const boards: Record<string, Board> = {
      A: board('A', null),
      B: board('B', 'A'),
    };
    await db.elements.bulkAdd([
      el('b-note', 'B'), // an element on the board being deleted
      el('link-on-A', 'A', { type: 'boardLink', content: { boardId: 'B' } }),
      el('link-other', 'A', { type: 'boardLink', content: { boardId: 'A' } }), // unrelated
    ]);

    const cmd = await buildDeleteBoardCmd(boards.B!, boards);
    const deletedIds = cmd.changes
      .filter((c) => c.entity === 'element' && c.after === null)
      .map((c) => c.id);

    expect(deletedIds).toContain('b-note'); // board's own element
    expect(deletedIds).toContain('link-on-A'); // orphaned link card → deleted
    expect(deletedIds).not.toContain('link-other'); // link to a different board → kept
    // The board itself is tombstoned.
    expect(
      cmd.changes.some((c) => c.entity === 'board' && c.id === 'B' && c.after === null),
    ).toBe(true);
  });

  it('re-parents sub-boards to the deleted board\'s parent', async () => {
    const boards: Record<string, Board> = {
      A: board('A', null),
      B: board('B', 'A'),
      C: board('C', 'B'), // child of B
    };
    const cmd = await buildDeleteBoardCmd(boards.B!, boards);
    const reparent = cmd.changes.find((c) => c.entity === 'board' && c.id === 'C');
    expect(reparent?.after && (reparent.after as Board).parentBoardId).toBe('A');
  });
});
