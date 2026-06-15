import { memo, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import type { BoardLinkContent, Element, LinkContent } from '@/db/types';
import { ElementBody } from './ElementBody';

/** Types whose height follows their content (measured, not dragged). */
export const AUTO_HEIGHT = new Set(['note', 'title', 'todo', 'column']);
const EDITABLE = new Set(['note', 'title', 'swatch', 'column']);
/** Types drawn without the white card chrome. */
const CHROMELESS = new Set(['title', 'column', 'comment', 'drawing']);
const CLIPPED = new Set(['image', 'link', 'swatch']);

interface Props {
  element: Element;
  selected: boolean;
  editing: boolean;
  flashing?: boolean;
  onPointerDown: (e: ReactPointerEvent, element: Element) => void;
}

export const ElementView = memo(function ElementView({
  element,
  selected,
  editing,
  flashing,
  onPointerDown,
}: Props) {
  const setEditing = useStore((s) => s.setEditing);
  const updateEphemeral = useStore((s) => s.updateEphemeral);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const autoHeight = AUTO_HEIGHT.has(element.type);

  // Keep stored h in sync with rendered height for auto-height cards so
  // marquee hit-testing and snapping use real bounds.
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

  const isCard = !CHROMELESS.has(element.type);

  return (
    <div
      ref={ref}
      data-element-id={element.id}
      onPointerDown={(e) => onPointerDown(e, element)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (EDITABLE.has(element.type)) setEditing(element.id);
        // Pointer capture retargets dblclick to this wrapper, so board
        // navigation must live here rather than on the card body.
        if (element.type === 'boardLink') {
          const target = (element.content as BoardLinkContent).boardId;
          if (useStore.getState().boards[target]) navigate(`/b/${target}`);
        }
        if (element.type === 'link') {
          const url = (element.content as LinkContent).url;
          if (/^https?:\/\//i.test(url)) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }
      }}
      className={[
        'absolute',
        isCard ? 'rounded-md border bg-card shadow-card' : 'rounded-md',
        CLIPPED.has(element.type) ? 'overflow-hidden' : '',
        selected
          ? isCard
            ? 'border-accent ring-2 ring-accent/60'
            : 'ring-2 ring-accent/60'
          : isCard
            ? 'border-card-border'
            : '',
        editing ? 'cursor-text' : 'cursor-default',
        flashing ? 'animate-pulse ring-4 ring-accent' : '',
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
      <ElementBody element={element} editing={editing} />
    </div>
  );
});
