import { db } from './schema';
import { newId } from './ids';
import type { Board, Element, NoteContent, SwatchContent, TitleContent } from './types';

function note(text: string): NoteContent {
  return {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  };
}

/** Seed a Welcome board on first launch (idempotent: only when no boards exist). */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.boards.count();
  if (count > 0) return;

  const now = Date.now();
  const boardId = newId();
  const board: Board = {
    id: boardId,
    title: 'Welcome',
    parentBoardId: null,
    sortIndex: 0,
    createdAt: now,
    updatedAt: now,
  };

  const base = {
    boardId,
    parentColumnId: null,
    sortIndex: 0,
    style: {},
    createdAt: now,
    updatedAt: now,
  };

  const elements: Element[] = [
    {
      ...base,
      id: newId(),
      type: 'title',
      x: 120,
      y: 80,
      w: 420,
      h: 56,
      zIndex: 1,
      content: { text: 'Welcome to Mosaic' } satisfies TitleContent,
    },
    {
      ...base,
      id: newId(),
      type: 'note',
      x: 120,
      y: 170,
      w: 260,
      h: 120,
      zIndex: 2,
      content: note(
        'This is your first board. Double-click anywhere to add a note, or drag elements in from the toolbar.',
      ),
    },
    {
      ...base,
      id: newId(),
      type: 'note',
      x: 420,
      y: 220,
      w: 260,
      h: 100,
      zIndex: 3,
      content: note('Everything is saved on this device automatically — Mosaic works fully offline.'),
    },
    {
      ...base,
      id: newId(),
      type: 'swatch',
      x: 720,
      y: 200,
      w: 140,
      h: 100,
      zIndex: 4,
      content: { hex: '#6C5CE7', label: 'Accent' } satisfies SwatchContent,
    },
  ];

  await db.transaction('rw', db.boards, db.elements, async () => {
    await db.boards.add(board);
    await db.elements.bulkAdd(elements);
  });
}
