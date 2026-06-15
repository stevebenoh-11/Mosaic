import { db } from '@/db/schema';
import { newId } from '@/db/ids';
import type { Board, BoardLinkContent, Element, LineContent } from '@/db/types';
import type { Change, Command } from './commands';

export function renameBoardCmd(board: Board, title: string): Command {
  return {
    label: 'Rename board',
    coalesceKey: `board:${board.id}`,
    changes: [
      { entity: 'board', id: board.id, before: board, after: { ...board, title } },
    ],
  };
}

export function reorderBoardCmd(
  moved: Board,
  newParentId: string | null,
  orderedSiblingIds: string[],
  allBoards: Record<string, Board>,
): Command {
  const changes: Change[] = [];
  orderedSiblingIds.forEach((id, i) => {
    const b = id === moved.id ? { ...moved, parentBoardId: newParentId } : allBoards[id];
    if (!b) return;
    if (b.sortIndex !== i || id === moved.id) {
      const before = allBoards[id];
      if (!before) return;
      changes.push({
        entity: 'board',
        id,
        before,
        after: { ...b, sortIndex: i },
      });
    }
  });
  return { label: 'Move board', changes };
}

/** True if `candidate` is `boardId` itself or one of its descendants. */
export function isDescendant(
  boards: Record<string, Board>,
  boardId: string,
  candidate: string | null,
): boolean {
  let cursor = candidate;
  while (cursor) {
    if (cursor === boardId) return true;
    cursor = boards[cursor]?.parentBoardId ?? null;
  }
  return false;
}

/**
 * Delete a board: tombstone the board and ALL its elements (loaded from
 * Dexie — they are usually not in memory), and re-parent its sub-boards to
 * the deleted board's parent. One undoable command.
 */
export async function buildDeleteBoardCmd(
  board: Board,
  boards: Record<string, Board>,
): Promise<Command> {
  const elements = await db.elements.where('boardId').equals(board.id).toArray();
  const ownIds = new Set(elements.map((el) => el.id));
  // Board-link cards on OTHER boards that point here would become dangling
  // "Missing board" cards — delete them too.
  const orphanLinks = (
    await db.elements
      .filter(
        (el) =>
          el.type === 'boardLink' &&
          (el.content as BoardLinkContent).boardId === board.id,
      )
      .toArray()
  ).filter((el) => !ownIds.has(el.id));
  const children = Object.values(boards).filter(
    (b) => b.parentBoardId === board.id,
  );
  const changes: Change[] = [
    ...elements.map(
      (el): Change => ({ entity: 'element', id: el.id, before: el, after: null }),
    ),
    ...orphanLinks.map(
      (el): Change => ({ entity: 'element', id: el.id, before: el, after: null }),
    ),
    ...children.map(
      (b): Change => ({
        entity: 'board',
        id: b.id,
        before: b,
        after: { ...b, parentBoardId: board.parentBoardId },
      }),
    ),
    { entity: 'board', id: board.id, before: board, after: null },
  ];
  return { label: `Delete board "${board.title}"`, changes };
}

/**
 * Move elements to another board. Comments pinned to moved cards follow;
 * lines move when both endpoints (or free points) come along, otherwise the
 * line is deleted with the move.
 */
export function moveElementsToBoardCmd(
  selected: Element[],
  allElements: Record<string, Element>,
  targetBoardId: string,
): Command {
  const ids = new Set(selected.map((e) => e.id));
  const sourceBoardId = selected[0]?.boardId;
  const moved: Element[] = [...selected];

  for (const el of Object.values(allElements)) {
    if (el.boardId !== sourceBoardId || ids.has(el.id)) continue;
    // Column children follow their column.
    if (el.parentColumnId && ids.has(el.parentColumnId)) {
      ids.add(el.id);
      moved.push(el);
    }
  }
  const changes: Change[] = moved.map((el) => ({
    entity: 'element',
    id: el.id,
    before: el,
    after: { ...el, boardId: targetBoardId },
  }));

  for (const el of Object.values(allElements)) {
    if (el.boardId !== sourceBoardId || ids.has(el.id)) continue;
    if (el.type === 'comment') {
      const c = el.content as { targetElementId?: string };
      if (c.targetElementId && ids.has(c.targetElementId)) {
        changes.push({
          entity: 'element',
          id: el.id,
          before: el,
          after: { ...el, boardId: targetBoardId },
        });
      }
    } else if (el.type === 'line') {
      const c = el.content as LineContent;
      const ends = [c.from, c.to];
      const refs = ends.filter(
        (end): end is { elementId: string } => 'elementId' in end,
      );
      const touching = refs.some((r) => ids.has(r.elementId));
      if (!touching) continue;
      const allMoving = refs.every((r) => ids.has(r.elementId));
      changes.push({
        entity: 'element',
        id: el.id,
        before: el,
        after: allMoving ? { ...el, boardId: targetBoardId } : null,
      });
    }
  }
  return {
    label: `Move ${moved.length > 1 ? `${moved.length} elements` : 'element'} to board`,
    changes,
  };
}

/**
 * Deep-clone elements with fresh ids onto a board, re-pointing internal
 * references (column membership, line endpoints, comment targets).
 * References to elements outside the set are dropped (lines become points
 * at their last location are not possible — such lines are skipped).
 */
export function cloneElements(
  source: Element[],
  targetBoardId: string,
  offset: { x: number; y: number },
  zStart: number,
): Element[] {
  const idMap = new Map(source.map((e) => [e.id, newId()]));
  const now = Date.now();
  let z = zStart;

  const out: Element[] = [];
  for (const el of source) {
    const copy: Element = {
      ...structuredClone(el),
      id: idMap.get(el.id)!,
      boardId: targetBoardId,
      x: el.x + offset.x,
      y: el.y + offset.y,
      zIndex: z++,
      createdAt: now,
      updatedAt: now,
    };
    if (copy.parentColumnId) {
      copy.parentColumnId = idMap.get(copy.parentColumnId) ?? null;
    }
    if (copy.type === 'line') {
      const c = copy.content as LineContent;
      const remap = (end: LineContent['from']): LineContent['from'] | null => {
        if ('point' in end) {
          return { point: { x: end.point.x + offset.x, y: end.point.y + offset.y } };
        }
        const mapped = idMap.get(end.elementId);
        return mapped ? { ...end, elementId: mapped } : null;
      };
      const from = remap(c.from);
      const to = remap(c.to);
      if (!from || !to) continue; // endpoint outside the copied set
      copy.content = { ...c, from, to };
    }
    if (copy.type === 'comment') {
      const c = copy.content as { targetElementId?: string };
      if (c.targetElementId) {
        const mapped = idMap.get(c.targetElementId);
        if (mapped) c.targetElementId = mapped;
        else delete c.targetElementId;
      }
    }
    out.push(copy);
  }
  return out;
}
