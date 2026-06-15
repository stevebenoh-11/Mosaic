import { Check, Eraser } from 'lucide-react';
import { useUiStore } from './uiStore';

const COLORS = [
  '#2D2A26', '#636E72', '#FFFFFF',
  '#E74C3C', '#E67E22', '#F1C40F',
  '#2ECC71', '#1ABC9C', '#3498DB',
  '#6C5CE7', '#9B59B6', '#E84393',
];
const WIDTHS = [2, 4, 8];
const RAINBOW =
  'conic-gradient(from 90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)';

export function DrawBar() {
  const drawMode = useUiStore((s) => s.drawMode);
  const setDrawMode = useUiStore((s) => s.setDrawMode);
  if (!drawMode.active) return null;

  const customActive =
    !drawMode.eraser &&
    !COLORS.some((c) => c.toLowerCase() === drawMode.color.toLowerCase());

  return (
    <div
      className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-card-border bg-card px-2.5 py-1.5 shadow-card-drag"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Drawing tools"
    >
      <div className="flex max-w-[212px] flex-wrap items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Pen color ${c}`}
            onClick={() => setDrawMode({ color: c, eraser: false })}
            className={`h-5 w-5 rounded-full border ${
              drawMode.color.toLowerCase() === c.toLowerCase() && !drawMode.eraser
                ? 'ring-2 ring-accent ring-offset-1'
                : 'border-card-border'
            }`}
            style={{ background: c }}
          />
        ))}
        {/* Custom colour: shows a rainbow until a non-preset colour is chosen. */}
        <label
          title="Custom color"
          aria-label="Custom pen color"
          className={`relative h-5 w-5 cursor-pointer overflow-hidden rounded-full border ${
            customActive ? 'ring-2 ring-accent ring-offset-1' : 'border-card-border'
          }`}
          style={{ background: customActive ? drawMode.color : RAINBOW }}
        >
          <input
            type="color"
            aria-label="Pick custom pen color"
            value={drawMode.color}
            onChange={(e) => setDrawMode({ color: e.target.value, eraser: false })}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <span className="h-5 w-px bg-card-border" />
      <div className="flex items-center gap-1">
        {WIDTHS.map((w) => (
          <button
            key={w}
            aria-label={`Pen width ${w}`}
            onClick={() => setDrawMode({ width: w, eraser: false })}
            className={`flex h-7 w-7 items-center justify-center rounded ${
              drawMode.width === w && !drawMode.eraser
                ? 'bg-accent-soft'
                : 'hover:bg-panel-border/60'
            }`}
          >
            <span
              className="rounded-full bg-ink"
              style={{ width: w + 2, height: w + 2 }}
            />
          </button>
        ))}
      </div>
      <span className="h-5 w-px bg-card-border" />
      <button
        aria-label="Eraser"
        title="Eraser (removes whole strokes)"
        onClick={() => setDrawMode({ eraser: !drawMode.eraser })}
        className={`flex h-7 w-7 items-center justify-center rounded ${
          drawMode.eraser ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-panel-border/60'
        }`}
      >
        <Eraser className="h-4 w-4" />
      </button>
      <button
        aria-label="Done drawing"
        onClick={() => setDrawMode({ active: false, eraser: false, activeDrawingId: null })}
        className="ml-1 flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90"
      >
        <Check className="h-3.5 w-3.5" /> Done
      </button>
    </div>
  );
}
