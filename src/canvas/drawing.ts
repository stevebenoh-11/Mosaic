/** Ramer–Douglas–Peucker simplification on a flat [x0,y0,x1,y1,...] array. */
export function simplifyPoints(points: number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points;

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const ax = points[start * 2]!;
    const ay = points[start * 2 + 1]!;
    const bx = points[end * 2]!;
    const by = points[end * 2 + 1]!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const px = points[i * 2]!;
      const py = points[i * 2 + 1]!;
      // Perpendicular distance from p to segment ab.
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let d: number;
      if (lenSq === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i * 2]!, points[i * 2 + 1]!);
  }
  return out;
}

export function strokeBounds(points: number[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]!);
    maxX = Math.max(maxX, points[i]!);
    minY = Math.min(minY, points[i + 1]!);
    maxY = Math.max(maxY, points[i + 1]!);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Distance from a point to the nearest vertex/segment of a polyline. */
export function distanceToPath(
  px: number,
  py: number,
  points: number[],
): number {
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!;
    const ay = points[i + 1]!;
    const bx = points[i + 2]!;
    const by = points[i + 3]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  if (points.length === 2) {
    best = Math.min(best, Math.hypot(px - points[0]!, py - points[1]!));
  }
  return best;
}
