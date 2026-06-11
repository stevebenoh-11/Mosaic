import type { CSSProperties } from 'react';
import { useStore } from '@/store';
import type {
  Element,
  NoteContent,
  SwatchContent,
  TitleContent,
  TipTapDoc,
} from '@/db/types';

const GRID_SPACING = 24;

/** Plain-text preview of a TipTap doc (M1 brings the real editor). */
export function docToText(doc: TipTapDoc): string {
  const parts: string[] = [];
  function walk(node: unknown): void {
    if (typeof node !== 'object' || node === null) return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(doc);
  return parts.join(' ');
}

function ElementCard({ element }: { element: Element }) {
  const base: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.w,
    minHeight: element.h,
    zIndex: element.zIndex,
  };

  switch (element.type) {
    case 'title': {
      const c = element.content as TitleContent;
      return (
        <div style={base} className="flex items-center">
          <h1 className="text-3xl font-bold tracking-tight">{c.text}</h1>
        </div>
      );
    }
    case 'swatch': {
      const c = element.content as SwatchContent;
      return (
        <div
          style={base}
          className="overflow-hidden rounded-md border border-card-border bg-card shadow-card"
        >
          <div style={{ background: c.hex }} className="h-2/3 min-h-16" />
          <div className="px-2 py-1.5 text-xs text-ink-soft">
            {c.label ? `${c.label} · ` : ''}
            {c.hex}
          </div>
        </div>
      );
    }
    case 'note':
    default: {
      const text =
        element.type === 'note'
          ? docToText((element.content as NoteContent).doc)
          : '';
      return (
        <div
          style={base}
          className="rounded-md border border-card-border bg-card p-3 text-sm shadow-card"
        >
          {text}
        </div>
      );
    }
  }
}

export function CanvasView({ boardId }: { boardId: string }) {
  const elements = useStore((s) => s.elements);
  const viewport = useStore((s) => s.viewport);

  const visible = Object.values(elements).filter(
    (e) => e.boardId === boardId && e.parentColumnId === null,
  );

  const spacing = GRID_SPACING * viewport.scale;

  return (
    <div
      data-testid="canvas"
      className="relative flex-1 touch-none overflow-hidden bg-canvas"
      style={{
        backgroundImage:
          'radial-gradient(circle, var(--color-grid-dot) 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {visible.map((e) => (
          <ElementCard key={e.id} element={e} />
        ))}
      </div>
    </div>
  );
}
