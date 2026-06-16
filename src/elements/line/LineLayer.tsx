import { memo } from 'react';
import { useStore } from '@/store';
import type { Element, LineContent, LineMarker } from '@/db/types';
import { linePath } from './geometry';

const STROKE = '#8a867e';

/** Resolve effective markers, tolerating legacy `arrowEnd`-only lines. */
export function effectiveMarkers(c: LineContent): { start: LineMarker; end: LineMarker } {
  return {
    start: c.startMarker ?? 'none',
    end: c.endMarker ?? (c.arrowEnd ? 'arrow' : 'none'),
  };
}

function MarkerDef({
  id,
  type,
  color,
}: {
  id: string;
  type: LineMarker;
  color: string;
}) {
  if (type === 'none') return null;
  const common = {
    id,
    viewBox: '0 0 10 10',
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: 'auto-start-reverse' as const,
  };
  if (type === 'arrow') {
    return (
      <marker {...common} refX={9}>
        <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
      </marker>
    );
  }
  if (type === 'circle') {
    return (
      <marker {...common} refX={5}>
        <circle cx={5} cy={5} r={4} fill={color} />
      </marker>
    );
  }
  return (
    <marker {...common} refX={5}>
      <rect x={1} y={1} width={8} height={8} fill={color} />
    </marker>
  );
}

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
      {lines.map((line) => {
        const c = line.content as LineContent;
        const geo = linePath(c, elements);
        if (!geo) return null;
        const selected = selection.includes(line.id);
        const color = selected ? 'var(--color-accent)' : (c.color ?? STROKE);
        const { start, end } = effectiveMarkers(c);
        const mid = { x: (geo.from.x + geo.to.x) / 2, y: (geo.from.y + geo.to.y) / 2 };
        return (
          <g key={line.id}>
            <defs>
              <MarkerDef id={`mk-start-${line.id}`} type={start} color={color} />
              <MarkerDef id={`mk-end-${line.id}`} type={end} color={color} />
            </defs>
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
              stroke={color}
              strokeWidth={selected ? 2.5 : 2}
              strokeDasharray={c.dashed ? '6 5' : undefined}
              markerStart={start !== 'none' ? `url(#mk-start-${line.id})` : undefined}
              markerEnd={end !== 'none' ? `url(#mk-end-${line.id})` : undefined}
              style={{ pointerEvents: 'none' }}
            />
            {c.label && (
              <text
                x={mid.x}
                y={mid.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                fill={selected ? 'var(--color-accent)' : 'var(--color-ink)'}
                stroke="var(--color-canvas)"
                strokeWidth={4}
                paintOrder="stroke"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {c.label}
              </text>
            )}
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
