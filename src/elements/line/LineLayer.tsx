import { memo } from 'react';
import { useStore } from '@/store';
import type { Element, LineContent } from '@/db/types';
import { linePath } from './geometry';

const STROKE = '#8a867e';

/**
 * SVG layer inside the world container. Lines re-route live because they
 * resolve endpoint geometry from the reactive store on every render.
 */
export const LineLayer = memo(function LineLayer({
  lines,
  elements,
  selection,
  onSelect,
  temp,
}: {
  lines: Element[];
  elements: Record<string, Element>;
  selection: string[];
  onSelect: (id: string, additive: boolean) => void;
  temp: { d: string } | null;
}) {
  return (
    <svg
      className="absolute left-0 top-0"
      style={{ width: 1, height: 1, overflow: 'visible' }}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
        </marker>
        <marker
          id="arrow-selected"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
        </marker>
      </defs>
      {lines.map((line) => {
        const c = line.content as LineContent;
        const geo = linePath(c, elements);
        if (!geo) return null;
        const selected = selection.includes(line.id);
        return (
          <g key={line.id}>
            {/* wide invisible stroke = generous hit area */}
            <path
              d={geo.d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(line.id, e.shiftKey);
              }}
            />
            <path
              d={geo.d}
              fill="none"
              stroke={selected ? 'var(--color-accent)' : STROKE}
              strokeWidth={selected ? 2.5 : 2}
              strokeDasharray={c.dashed ? '6 5' : undefined}
              markerEnd={
                c.arrowEnd
                  ? `url(#${selected ? 'arrow-selected' : 'arrow'})`
                  : undefined
              }
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}
      {temp && (
        <path
          d={temp.d}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeDasharray="4 4"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
});

export function useLineToolbarActions(lineId: string | null) {
  const execute = useStore((s) => s.execute);
  if (!lineId) return null;
  return function toggle(prop: 'curve' | 'dashed' | 'arrowEnd') {
    const state = useStore.getState();
    const before = state.elements[lineId];
    if (!before) return;
    const c = before.content as LineContent;
    const after: Element = {
      ...before,
      content: { ...c, [prop]: !c[prop] },
    };
    execute({
      label: 'Edit line',
      changes: [{ entity: 'element', id: lineId, before, after }],
    });
  };
}
