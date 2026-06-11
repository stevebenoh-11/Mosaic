import type { Element } from '@/db/types';
import type { Rect } from './coords';

export interface SnapGuide {
  axis: 'x' | 'y';
  /** World coordinate of the guide line. */
  at: number;
  /** Extent of the guide along the other axis (for rendering). */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

function edges(r: Rect, axis: 'x' | 'y'): number[] {
  return axis === 'x'
    ? [r.x, r.x + r.w / 2, r.x + r.w]
    : [r.y, r.y + r.h / 2, r.y + r.h];
}

/**
 * Snap a moving rect against nearby elements' edges and centers.
 * `threshold` is in world units (caller divides 8px by the current scale).
 */
export function computeSnap(
  moving: Rect,
  others: Element[],
  threshold: number,
): SnapResult {
  let bestDx: { delta: number; guide: SnapGuide } | null = null;
  let bestDy: { delta: number; guide: SnapGuide } | null = null;

  for (const o of others) {
    const or: Rect = { x: o.x, y: o.y, w: o.w, h: o.h };
    for (const oe of edges(or, 'x')) {
      for (const me of edges(moving, 'x')) {
        const delta = oe - me;
        if (
          Math.abs(delta) <= threshold &&
          (!bestDx || Math.abs(delta) < Math.abs(bestDx.delta))
        ) {
          bestDx = {
            delta,
            guide: {
              axis: 'x',
              at: oe,
              from: Math.min(moving.y, or.y) - 8,
              to: Math.max(moving.y + moving.h, or.y + or.h) + 8,
            },
          };
        }
      }
    }
    for (const oe of edges(or, 'y')) {
      for (const me of edges(moving, 'y')) {
        const delta = oe - me;
        if (
          Math.abs(delta) <= threshold &&
          (!bestDy || Math.abs(delta) < Math.abs(bestDy.delta))
        ) {
          bestDy = {
            delta,
            guide: {
              axis: 'y',
              at: oe,
              from: Math.min(moving.x, or.x) - 8,
              to: Math.max(moving.x + moving.w, or.x + or.w) + 8,
            },
          };
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (bestDx) guides.push(bestDx.guide);
  if (bestDy) guides.push(bestDy.guide);
  return { dx: bestDx?.delta ?? 0, dy: bestDy?.delta ?? 0, guides };
}
