import { newId } from '@/db/ids';
import type {
  Element,
  ElementContent,
  ElementStyle,
  ElementType,
  LineContent,
} from '@/db/types';
import type { Change, Command } from './commands';

/**
 * Expand a target set with the elements that depend on it: column children go
 * with their column, and lines/comments referencing a victim go with it. Used
 * by cut / copy / delete so dependents don't dangle.
 */
export function withDependents(
  elements: Record<string, Element>,
  boardId: string,
  targets: Element[],
): Element[] {
  const ids = new Set(targets.map((e) => e.id));
  const all = [...targets];
  for (const el of Object.values(elements)) {
    if (el.boardId !== boardId || ids.has(el.id)) continue;
    if (el.parentColumnId && ids.has(el.parentColumnId)) {
      ids.add(el.id);
      all.push(el);
    }
  }
  for (const el of Object.values(elements)) {
    if (el.boardId !== boardId || ids.has(el.id)) continue;
    if (el.type === 'line') {
      const c = el.content as LineContent;
      const refs = [c.from, c.to].some(
        (end) => 'elementId' in end && ids.has(end.elementId),
      );
      if (refs) {
        ids.add(el.id);
        all.push(el);
      }
    } else if (el.type === 'comment') {
      const c = el.content as { targetElementId?: string };
      if (c.targetElementId && ids.has(c.targetElementId)) {
        ids.add(el.id);
        all.push(el);
      }
    }
  }
  return all;
}

/** Default sizes per element type (world units = px at 100%). */
export const DEFAULT_SIZES: Record<ElementType, { w: number; h: number }> = {
  note: { w: 200, h: 56 },
  title: { w: 320, h: 48 },
  image: { w: 280, h: 200 },
  link: { w: 260, h: 96 },
  todo: { w: 220, h: 120 },
  column: { w: 240, h: 160 },
  swatch: { w: 140, h: 100 },
  line: { w: 0, h: 0 },
  drawing: { w: 300, h: 200 },
  boardLink: { w: 180, h: 110 },
  comment: { w: 36, h: 36 },
  document: { w: 220, h: 150 },
};

export function emptyNoteDoc(): ElementContent {
  return { doc: { type: 'doc', content: [{ type: 'paragraph' }] } };
}

export function defaultContent(type: ElementType): ElementContent {
  switch (type) {
    case 'note':
      return emptyNoteDoc();
    case 'document':
      return { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, title: 'New Document' };
    case 'title':
      return { text: '' };
    case 'todo':
      return { title: 'New To-do List', items: [] };
    case 'column':
      return { title: 'Column', collapsed: false };
    case 'swatch':
      return { hex: '#6C5CE7' };
    case 'image':
      return { assetId: '', naturalW: 0, naturalH: 0 };
    case 'link':
      return { url: '' };
    case 'line':
      return {
        from: { point: { x: 0, y: 0 } },
        to: { point: { x: 100, y: 0 } },
        curve: false,
        dashed: false,
        arrowEnd: true,
      };
    case 'drawing':
      return { paths: [] };
    case 'boardLink':
      return { boardId: '' };
    case 'comment':
      return {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        authorName: 'You',
        resolved: false,
      };
  }
}

export function buildElement(
  boardId: string,
  type: ElementType,
  x: number,
  y: number,
  zIndex: number,
  overrides?: Partial<Element>,
): Element {
  const now = Date.now();
  const size = DEFAULT_SIZES[type];
  return {
    id: newId(),
    boardId,
    type,
    x,
    y,
    w: size.w,
    h: size.h,
    zIndex,
    parentColumnId: null,
    sortIndex: 0,
    content: defaultContent(type),
    style: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createElementCmd(element: Element): Command {
  return {
    label: `Create ${element.type}`,
    changes: [{ entity: 'element', id: element.id, before: null, after: element }],
  };
}

export function deleteElementsCmd(elements: Element[]): Command {
  return {
    label: `Delete ${elements.length > 1 ? `${elements.length} elements` : (elements[0]?.type ?? 'element')}`,
    changes: elements.map(
      (e): Change => ({ entity: 'element', id: e.id, before: e, after: null }),
    ),
  };
}

/** Snapshot-based update: `before` from interaction start, `after` final. */
export function updateElementsCmd(
  label: string,
  before: Element[],
  after: Element[],
  coalesceKey?: string,
): Command {
  const byId = new Map(after.map((e) => [e.id, e]));
  const cmd: Command = {
    label,
    changes: before.flatMap((b): Change[] => {
      const a = byId.get(b.id);
      if (!a) return [];
      return [{ entity: 'element', id: b.id, before: b, after: a }];
    }),
  };
  if (coalesceKey !== undefined) cmd.coalesceKey = coalesceKey;
  return cmd;
}

export function duplicateElementsCmd(
  elements: Element[],
  offset = 16,
  zStart?: number,
): { command: Command; newIds: string[] } {
  const now = Date.now();
  let z = zStart ?? Math.max(0, ...elements.map((e) => e.zIndex)) + 1;
  const copies = elements.map((e): Element => {
    return {
      ...structuredClone(e),
      id: newId(),
      x: e.x + offset,
      y: e.y + offset,
      zIndex: z++,
      parentColumnId: null,
      createdAt: now,
      updatedAt: now,
    };
  });
  return {
    command: {
      label: `Duplicate ${elements.length > 1 ? `${elements.length} elements` : (elements[0]?.type ?? 'element')}`,
      changes: copies.map(
        (c): Change => ({ entity: 'element', id: c.id, before: null, after: c }),
      ),
    },
    newIds: copies.map((c) => c.id),
  };
}

/**
 * Z-order changes for the selected elements among their board siblings.
 * 'forward'/'backward' step over the nearest neighbor; 'front'/'back' jump.
 */
export function zOrderCmd(
  selected: Element[],
  siblings: Element[],
  dir: 'forward' | 'backward' | 'front' | 'back',
): Command | null {
  if (selected.length === 0) return null;
  const selIds = new Set(selected.map((e) => e.id));
  const others = siblings.filter((e) => !selIds.has(e.id));
  const changes: Change[] = [];

  if (dir === 'front' || dir === 'back') {
    const maxZ = Math.max(0, ...others.map((e) => e.zIndex));
    const minZ = Math.min(0, ...others.map((e) => e.zIndex));
    const sorted = [...selected].sort((a, b) => a.zIndex - b.zIndex);
    sorted.forEach((e, i) => {
      const z = dir === 'front' ? maxZ + 1 + i : minZ - sorted.length + i;
      changes.push({
        entity: 'element',
        id: e.id,
        before: e,
        after: { ...e, zIndex: z },
      });
    });
  } else {
    for (const e of selected) {
      const candidates =
        dir === 'forward'
          ? others.filter((o) => o.zIndex > e.zIndex)
          : others.filter((o) => o.zIndex < e.zIndex);
      if (candidates.length === 0) continue;
      const neighbor = candidates.reduce((best, o) =>
        dir === 'forward'
          ? o.zIndex < best.zIndex
            ? o
            : best
          : o.zIndex > best.zIndex
            ? o
            : best,
      );
      // Swap z with the nearest neighbor in that direction.
      changes.push(
        { entity: 'element', id: e.id, before: e, after: { ...e, zIndex: neighbor.zIndex } },
        { entity: 'element', id: neighbor.id, before: neighbor, after: { ...neighbor, zIndex: e.zIndex } },
      );
    }
  }
  if (changes.length === 0) return null;
  return { label: 'Reorder', changes };
}

/** Element types that may be stacked inside a column. */
export const COLUMNABLE_TYPES = new Set<ElementType>([
  'note',
  'title',
  'image',
  'link',
  'todo',
  'swatch',
  'boardLink',
  'document',
]);

/** Merge a partial style onto each element (colour, lock, labels, reactions). */
export function updateStyleCmd(
  label: string,
  elements: Element[],
  patch: Partial<ElementStyle>,
  coalesceKey?: string,
): Command {
  const cmd: Command = {
    label,
    changes: elements.map(
      (e): Change => ({
        entity: 'element',
        id: e.id,
        before: e,
        after: { ...e, style: { ...e.style, ...patch } },
      }),
    ),
  };
  if (coalesceKey !== undefined) cmd.coalesceKey = coalesceKey;
  return cmd;
}

/**
 * Wrap the selected (column-able) elements in a new column. Returns the command
 * and the new column id, or null when nothing groupable is selected.
 */
export function groupIntoColumnCmd(
  selected: Element[],
  maxZ: number,
): { command: Command; columnId: string } | null {
  const children = selected.filter(
    (e) => COLUMNABLE_TYPES.has(e.type) && e.parentColumnId === null,
  );
  if (children.length === 0) return null;
  const boardId = children[0]!.boardId;
  const bx = Math.min(...children.map((e) => e.x));
  const by = Math.min(...children.map((e) => e.y));
  const ordered = [...children].sort((a, b) => a.y - b.y || a.x - b.x);

  const column = buildElement(boardId, 'column', bx, by, maxZ + 1, {
    content: { title: 'New Column', collapsed: false },
  });
  const changes: Change[] = [
    { entity: 'element', id: column.id, before: null, after: column },
    ...ordered.map(
      (e, i): Change => ({
        entity: 'element',
        id: e.id,
        before: e,
        after: { ...e, parentColumnId: column.id, sortIndex: i },
      }),
    ),
  ];
  return {
    command: { label: 'Group into column', changes },
    columnId: column.id,
  };
}
