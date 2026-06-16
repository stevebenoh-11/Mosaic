import { memo, useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useStore } from '@/store';
import { useUiStore } from '@/ui/uiStore';
import { updateStyleCmd } from '@/store/elementCommands';
import type { BoardLinkContent, Element, LinkContent } from '@/db/types';
import { ElementBody } from './ElementBody';

/** Types whose height follows their content (measured, not dragged). */
export const AUTO_HEIGHT = new Set(['note', 'title', 'todo', 'column', 'document']);
const EDITABLE = new Set(['note', 'title', 'swatch', 'column']);
/** Types drawn without the white card chrome. */
const CHROMELESS = new Set(['title', 'column', 'comment', 'drawing']);
const CLIPPED = new Set(['image', 'link', 'swatch']);
/** Types where a custom colour tints the card background vs. the text. */
const TEXT_COLORED = new Set(['title']);

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
  const locked = !!element.style.locked;
  const color = element.style.color;
  const labels = element.style.labels ?? [];
  const reactions = element.style.reactions ?? {};
  const reactionEntries = Object.entries(reactions).filter(([, n]) => n > 0);

  // Custom colour: tints the card background, or the text for headings.
  const colorStyle: CSSProperties = {};
  if (color) {
    if (TEXT_COLORED.has(element.type)) colorStyle.color = color;
    else if (isCard && element.type !== 'swatch') colorStyle.backgroundColor = color;
  }

  function addReaction(emoji: string) {
    const current = useStore.getState().elements[element.id];
    if (!current) return;
    const next = { ...(current.style.reactions ?? {}) };
    next[emoji] = (next[emoji] ?? 0) + 1;
    useStore.getState().execute(updateStyleCmd('React', [current], { reactions: next }));
  }

  return (
    <div
      ref={ref}
      data-element-id={element.id}
      onPointerDown={(e) => onPointerDown(e, element)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (locked) return;
        if (EDITABLE.has(element.type)) setEditing(element.id);
        // Documents open in an expanded editor rather than editing inline.
        if (element.type === 'document') {
          useUiStore.getState().setOpenDocumentId(element.id);
        }
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
        'absolute transition-shadow',
        isCard ? 'rounded-md border bg-card shadow-card' : 'rounded-md',
        CLIPPED.has(element.type) ? 'overflow-hidden' : '',
        selected
          ? isCard
            ? 'border-accent ring-2 ring-accent/60'
            : 'ring-2 ring-accent/60'
          : isCard
            ? 'border-card-border'
            : '',
        editing ? 'cursor-text' : locked ? 'cursor-default' : 'cursor-default',
        flashing ? 'animate-pulse ring-4 ring-accent' : '',
      ].join(' ')}
      style={{
        left: element.x,
        top: element.y,
        width: element.w,
        height: autoHeight ? 'auto' : element.h,
        minHeight: autoHeight ? 40 : undefined,
        zIndex: element.zIndex,
        ...colorStyle,
      }}
    >
      <ElementBody element={element} editing={editing} />

      {/* labels — chips above the card */}
      {labels.length > 0 && (
        <div className="pointer-events-none absolute bottom-full left-1 mb-1 flex max-w-full flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent shadow-sm"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* reactions — chips below the card (click to add another) */}
      {reactionEntries.length > 0 && (
        <div className="absolute right-1 top-full mt-1 flex flex-wrap justify-end gap-1">
          {reactionEntries.map(([emoji, n]) => (
            <button
              key={emoji}
              type="button"
              aria-label={`${emoji} reaction (${n})`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => addReaction(emoji)}
              className="flex items-center gap-0.5 rounded-full border border-card-border bg-card px-1.5 py-0.5 text-[11px] leading-none shadow-sm hover:bg-panel-border/40"
            >
              <span>{emoji}</span>
              {n > 1 && <span className="text-ink-soft">{n}</span>}
            </button>
          ))}
        </div>
      )}

      {/* lock badge */}
      {locked && (
        <div className="pointer-events-none absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-card-border bg-card text-ink-soft shadow-sm">
          <Lock className="h-3 w-3" />
        </div>
      )}
    </div>
  );
});
