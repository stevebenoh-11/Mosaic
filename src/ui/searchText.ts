import type {
  ColumnContent,
  CommentContent,
  Element,
  LinkContent,
  SwatchContent,
  TipTapDoc,
  TitleContent,
  TodoContent,
} from '@/db/types';

export function docText(doc: TipTapDoc): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return parts.join(' ');
}

/** Searchable plain text of an element (empty string = not searchable). */
export function elementText(el: Element): string {
  switch (el.type) {
    case 'note':
      return docText((el.content as { doc: TipTapDoc }).doc);
    case 'title':
      return (el.content as TitleContent).text;
    case 'todo': {
      const c = el.content as TodoContent;
      return [c.title ?? '', ...c.items.map((i) => i.text)].join(' ');
    }
    case 'link': {
      const c = el.content as LinkContent;
      return [c.title ?? '', c.description ?? '', c.url].join(' ');
    }
    case 'column':
      return (el.content as ColumnContent).title;
    case 'swatch': {
      const c = el.content as SwatchContent;
      return [c.label ?? '', c.hex].join(' ');
    }
    case 'comment':
      return docText((el.content as CommentContent).doc);
    default:
      return '';
  }
}

/** Simple fuzzy score: all query tokens must appear; earlier hits rank higher. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  for (const token of q.split(/\s+/)) {
    const idx = t.indexOf(token);
    if (idx < 0) return -1;
    score += 100 - Math.min(idx, 80) + Math.min(token.length * 4, 30);
  }
  if (t.startsWith(q)) score += 60;
  return score;
}
