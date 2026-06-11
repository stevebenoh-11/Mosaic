import type { Element, LineContent, LineEndpoint } from '@/db/types';

export type Side = 'n' | 'e' | 's' | 'w';

export interface ResolvedEnd {
  x: number;
  y: number;
  /** Outward normal direction for curve control points. */
  nx: number;
  ny: number;
}

const NORMALS: Record<Side, [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

export function anchorPoint(el: Element, side: Side): { x: number; y: number } {
  switch (side) {
    case 'n':
      return { x: el.x + el.w / 2, y: el.y };
    case 'e':
      return { x: el.x + el.w, y: el.y + el.h / 2 };
    case 's':
      return { x: el.x + el.w / 2, y: el.y + el.h };
    case 'w':
      return { x: el.x, y: el.y + el.h / 2 };
  }
}

/** Side of `el` closest to facing `toward`. */
export function nearestSide(el: Element, toward: { x: number; y: number }): Side {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) * el.h > Math.abs(dy) * el.w) return dx > 0 ? 'e' : 'w';
  return dy > 0 ? 's' : 'n';
}

export function resolveEnd(
  end: LineEndpoint,
  elements: Record<string, Element>,
  toward: { x: number; y: number },
): ResolvedEnd | null {
  if ('point' in end) {
    const dx = toward.x - end.point.x;
    const dy = toward.y - end.point.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: end.point.x, y: end.point.y, nx: dx / len, ny: dy / len };
  }
  const el = elements[end.elementId];
  if (!el) return null;
  const side = end.side ?? nearestSide(el, toward);
  const p = anchorPoint(el, side);
  const [nx, ny] = NORMALS[side];
  return { ...p, nx, ny };
}

export function roughTarget(
  end: LineEndpoint,
  elements: Record<string, Element>,
): { x: number; y: number } | null {
  if ('point' in end) return end.point;
  const el = elements[end.elementId];
  if (!el) return null;
  return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
}

/** SVG path for a line's current geometry, or null if an endpoint is gone. */
export function linePath(
  content: LineContent,
  elements: Record<string, Element>,
): { d: string; from: ResolvedEnd; to: ResolvedEnd } | null {
  const towardTo = roughTarget(content.to, elements);
  const towardFrom = roughTarget(content.from, elements);
  if (!towardTo || !towardFrom) return null;
  const from = resolveEnd(content.from, elements, towardTo);
  const to = resolveEnd(content.to, elements, towardFrom);
  if (!from || !to) return null;

  if (!content.curve) {
    return { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, from, to };
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.min(160, Math.max(40, dist / 2));
  const c1x = from.x + from.nx * k;
  const c1y = from.y + from.ny * k;
  const c2x = to.x + to.nx * k;
  const c2y = to.y + to.ny * k;
  return {
    d: `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`,
    from,
    to,
  };
}
