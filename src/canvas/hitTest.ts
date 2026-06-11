import type { Element } from '@/db/types';
import type { Point } from './coords';

const NOT_TARGETABLE = new Set(['line', 'comment', 'drawing']);

/** Topmost canvas card containing the world point (lines/comments excluded). */
export function topElementAt(
  elements: Record<string, Element>,
  boardId: string,
  world: Point,
  exclude?: Set<string>,
): Element | null {
  let best: Element | null = null;
  for (const el of Object.values(elements)) {
    if (el.boardId !== boardId || el.parentColumnId !== null) continue;
    if (NOT_TARGETABLE.has(el.type)) continue;
    if (exclude?.has(el.id)) continue;
    if (
      world.x >= el.x &&
      world.x <= el.x + el.w &&
      world.y >= el.y &&
      world.y <= el.y + el.h
    ) {
      if (!best || el.zIndex > best.zIndex) best = el;
    }
  }
  return best;
}
