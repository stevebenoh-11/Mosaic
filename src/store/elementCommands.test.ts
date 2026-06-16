import { describe, expect, it } from 'vitest';
import type { Element } from '@/db/types';
import {
  groupIntoColumnCmd,
  updateStyleCmd,
  withDependents,
} from './elementCommands';

function el(id: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    boardId: 'B',
    type: 'note',
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    zIndex: 1,
    parentColumnId: null,
    sortIndex: 0,
    content: { doc: { type: 'doc' } },
    style: {},
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe('updateStyleCmd', () => {
  it('merges a partial style onto each element, preserving other fields', () => {
    const a = el('a', { style: { color: '#fff', locked: true } });
    const cmd = updateStyleCmd('Set color', [a], { color: '#000' });
    const after = cmd.changes[0]!.after as Element;
    expect(after.style.color).toBe('#000');
    expect(after.style.locked).toBe(true); // untouched
  });
});

describe('groupIntoColumnCmd', () => {
  it('creates a column and re-parents column-able children in y order', () => {
    const a = el('a', { x: 40, y: 80 });
    const b = el('b', { x: 10, y: 20 });
    const res = groupIntoColumnCmd([a, b], 5);
    expect(res).not.toBeNull();
    const { command, columnId } = res!;
    const colChange = command.changes.find((c) => c.id === columnId)!;
    const col = colChange.after as Element;
    expect(col.type).toBe('column');
    // Column is placed at the bounding-box top-left.
    expect(col.x).toBe(10);
    expect(col.y).toBe(20);
    expect(col.zIndex).toBe(6); // maxZ + 1
    // Children re-parented, ordered by y (b before a).
    const childChanges = command.changes.filter((c) => c.id !== columnId);
    const order = childChanges.map((c) => (c.after as Element).id);
    expect(order).toEqual(['b', 'a']);
    for (const c of childChanges) {
      expect((c.after as Element).parentColumnId).toBe(columnId);
    }
  });

  it('returns null when nothing groupable is selected', () => {
    const line = el('l', { type: 'line' });
    expect(groupIntoColumnCmd([line], 0)).toBeNull();
  });
});

describe('withDependents', () => {
  it('includes column children, lines and comments referencing the targets', () => {
    const elements: Record<string, Element> = {
      col: el('col', { type: 'column' }),
      child: el('child', { parentColumnId: 'col' }),
      note: el('note'),
      line: el('line', {
        type: 'line',
        content: { from: { elementId: 'note' }, to: { point: { x: 0, y: 0 } }, curve: false, dashed: false, arrowEnd: true },
      }),
      pin: el('pin', { type: 'comment', content: { doc: { type: 'doc' }, authorName: 'You', resolved: false, targetElementId: 'note' } as Element['content'] }),
      other: el('other'),
    };
    const result = withDependents(elements, 'B', [elements.col!, elements.note!]);
    const ids = result.map((e) => e.id).sort();
    expect(ids).toEqual(['child', 'col', 'line', 'note', 'pin']);
    expect(ids).not.toContain('other');
  });
});
