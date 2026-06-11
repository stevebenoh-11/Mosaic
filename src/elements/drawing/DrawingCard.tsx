import { memo } from 'react';
import type { DrawingContent, Element } from '@/db/types';

/** Paths are element-local coordinates; rendered as simple polylines. */
export const DrawingCard = memo(function DrawingCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as DrawingContent;
  return (
    <svg
      width={element.w}
      height={element.h}
      className="pointer-events-none block"
      style={{ overflow: 'visible' }}
    >
      {c.paths.map((p, i) => (
        <polyline
          key={i}
          points={Array.from({ length: p.points.length / 2 }, (_, j) =>
            `${p.points[j * 2]},${p.points[j * 2 + 1]}`,
          ).join(' ')}
          fill="none"
          stroke={p.color}
          strokeWidth={p.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
});
