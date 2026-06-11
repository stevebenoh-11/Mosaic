import { memo, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '@/store';
import type { Element } from '@/db/types';
import { NoteCard } from './note/NoteCard';
import { TitleCard } from './title/TitleCard';
import { SwatchCard } from './swatch/SwatchCard';

/** Types whose height follows their content (measured, not dragged). */
const AUTO_HEIGHT = new Set(['note', 'title']);
const EDITABLE = new Set(['note', 'title']);

interface Props {
  element: Element;
  selected: boolean;
  editing: boolean;
  dimmed?: boolean;
  onPointerDown: (e: ReactPointerEvent, element: Element) => void;
}

export const ElementView = memo(function ElementView({
  element,
  selected,
  editing,
  onPointerDown,
}: Props) {
  const setEditing = useStore((s) => s.setEditing);
  const updateEphemeral = useStore((s) => s.updateEphemeral);
  const ref = useRef<HTMLDivElement>(null);

  const autoHeight = AUTO_HEIGHT.has(element.type);

  // Keep stored h in sync with rendered height for auto-height cards so
  // marquee hit-testing and snapping use real bounds (presentation-derived,
  // no command needed).
  useEffect(() => {
    if (!autoHeight || !ref.current) return;
    const node = ref.current;
    const observer = new ResizeObserver(() => {
      const h = node.offsetHeight;
      const current = useStore.getState().elements[element.id];
      if (current && Math.abs(current.h - h) > 1) {
        updateEphemeral({ [element.id]: { h } });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [autoHeight, element.id, updateEphemeral]);

  const isCard = element.type !== 'title';

  return (
    <div
      ref={ref}
      data-element-id={element.id}
      onPointerDown={(e) => onPointerDown(e, element)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (EDITABLE.has(element.type)) setEditing(element.id);
      }}
      className={[
        'absolute',
        isCard
          ? 'rounded-md border bg-card shadow-card'
          : '',
        selected
          ? 'border-accent ring-2 ring-accent/60'
          : isCard
            ? 'border-card-border'
            : '',
        editing ? 'cursor-text' : 'cursor-default',
      ].join(' ')}
      style={{
        left: element.x,
        top: element.y,
        width: element.w,
        height: autoHeight ? 'auto' : element.h,
        minHeight: autoHeight ? 40 : undefined,
        zIndex: element.zIndex,
      }}
    >
      {element.type === 'note' && (
        <NoteCard element={element} editing={editing} />
      )}
      {element.type === 'title' && (
        <TitleCard element={element} editing={editing} />
      )}
      {element.type === 'swatch' && <SwatchCard element={element} />}
    </div>
  );
});
