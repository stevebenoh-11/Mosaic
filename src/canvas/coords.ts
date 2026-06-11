import type { Viewport } from '@/store';
import type { Element } from '@/db/types';

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function screenToWorld(p: Point, v: Viewport): Point {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function worldToScreen(p: Point, v: Viewport): Point {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Zoom keeping the given screen point fixed. */
export function zoomAt(v: Viewport, screenPoint: Point, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const world = screenToWorld(screenPoint, v);
  return {
    scale,
    x: screenPoint.x - world.x * scale,
    y: screenPoint.y - world.y * scale,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function elementRect(e: Element): Rect {
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

export function boundingBox(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Viewport that fits `content` into a `viewW`×`viewH` screen with padding. */
export function fitToContent(
  content: Rect | null,
  viewW: number,
  viewH: number,
  padding = 64,
): Viewport {
  if (!content || content.w <= 0 || content.h <= 0) {
    return { x: viewW / 2, y: viewH / 2, scale: 1 };
  }
  const scale = clampScale(
    Math.min(
      (viewW - padding * 2) / content.w,
      (viewH - padding * 2) / content.h,
      1.5,
    ),
  );
  return {
    scale,
    x: viewW / 2 - (content.x + content.w / 2) * scale,
    y: viewH / 2 - (content.y + content.h / 2) * scale,
  };
}
