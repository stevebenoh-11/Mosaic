import { useState, type RefObject } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useStore } from '@/store';
import type { Element } from '@/db/types';
import { boundingBox, elementRect, fitToContent, zoomAt } from './coords';

export function ZoomControls({
  containerRef,
  boardElements,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  boardElements: Element[];
}) {
  const viewport = useStore((s) => s.viewport);
  const setViewport = useStore((s) => s.setViewport);
  const [menuOpen, setMenuOpen] = useState(false);

  function center() {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect
      ? { x: rect.width / 2, y: rect.height / 2 }
      : { x: 400, y: 300 };
  }

  function zoomBy(factor: number) {
    setViewport(zoomAt(viewport, center(), viewport.scale * factor));
  }

  function fit() {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bbox = boundingBox(boardElements.map(elementRect));
    setViewport(fitToContent(bbox, rect.width, rect.height));
    setMenuOpen(false);
  }

  function reset() {
    setViewport(zoomAt(viewport, center(), 1));
    setMenuOpen(false);
  }

  return (
    <div
      className="absolute bottom-16 right-3 z-40 flex items-center gap-1 rounded-lg border border-card-border bg-card p-1 shadow-card sm:bottom-4 sm:right-4"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Zoom out"
        onClick={() => zoomBy(1 / 1.2)}
        className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="relative">
        <button
          aria-label="Zoom level"
          onClick={() => setMenuOpen((v) => !v)}
          className="min-w-14 rounded px-1 py-1 text-center text-xs font-medium text-ink hover:bg-panel-border/60"
        >
          {Math.round(viewport.scale * 100)}%
        </button>
        {menuOpen && (
          <div className="absolute bottom-9 left-1/2 w-36 -translate-x-1/2 rounded-lg border border-card-border bg-card py-1 shadow-card-drag">
            <button
              onClick={reset}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-panel-border/40"
            >
              100%
            </button>
            <button
              onClick={fit}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-panel-border/40"
            >
              <Maximize className="h-3.5 w-3.5" /> Fit to content
            </button>
          </div>
        )}
      </div>
      <button
        aria-label="Zoom in"
        onClick={() => zoomBy(1.2)}
        className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
