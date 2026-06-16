import { memo, useEffect, useState } from 'react';
import { useStore } from '@/store';
import type { ColorFormat, Element, SwatchContent } from '@/db/types';
import { formatColor, hexToHsl, hslToHex, type Hsl } from './color';

const FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl', 'off'];

/** Curated palette shown on the card for one-click colour swapping. */
const PRESETS = [
  '#E74C3C', '#E67E22', '#F1C40F', '#2ECC71', '#1ABC9C',
  '#3498DB', '#6C5CE7', '#9B59B6', '#E84393', '#FF7675',
  '#2D3436', '#636E72', '#B2BEC3', '#FFFFFF', '#0A0A0A',
];

function commitSwatch(element: Element, patch: Partial<SwatchContent>, label: string) {
  const state = useStore.getState();
  const before = state.elements[element.id];
  if (!before) return;
  const after: Element = {
    ...before,
    content: { ...(before.content as SwatchContent), ...patch },
  };
  state.execute({
    label,
    coalesceKey: `swatch:${element.id}`,
    changes: [{ entity: 'element', id: element.id, before, after }],
  });
}

/** Inline colour picker: a rainbow hue "cycle" plus saturation/lightness. */
function ColorPicker({ element, hex }: { element: Element; hex: string }) {
  // Keep HSL in local state so dragging the hue past grey/black/white doesn't
  // make the slider jump (those colours have an ambiguous hue).
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(hex));

  // Re-sync when the colour changes from outside this picker (preset click, undo).
  useEffect(() => {
    const next = hexToHsl(hex);
    setHsl((prev) =>
      hslToHex(prev) === hex.toUpperCase() ? prev : next,
    );
  }, [hex]);

  function update(patch: Partial<Hsl>) {
    const next = { ...hsl, ...patch };
    setHsl(next);
    commitSwatch(element, { hex: hslToHex(next) }, 'Change color');
  }

  const hueTrack =
    'linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)';
  const satTrack = `linear-gradient(to right,hsl(${hsl.h},0%,${hsl.l}%),hsl(${hsl.h},100%,${hsl.l}%))`;
  const lightTrack = `linear-gradient(to right,#000,hsl(${hsl.h},${hsl.s}%,50%),#fff)`;

  return (
    <div className="flex flex-col gap-1.5">
      <Slider label="Hue" max={360} value={hsl.h} track={hueTrack} onChange={(h) => update({ h })} />
      <Slider label="Saturation" max={100} value={hsl.s} track={satTrack} onChange={(s) => update({ s })} />
      <Slider label="Lightness" max={100} value={hsl.l} track={lightTrack} onChange={(l) => update({ l })} />
    </div>
  );
}

function Slider({
  label,
  value,
  max,
  track,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  track: string;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={0}
      max={max}
      value={value}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(Number(e.target.value))}
      className="swatch-range h-3 w-full cursor-pointer appearance-none rounded-full"
      style={{ background: track }}
    />
  );
}

export const SwatchCard = memo(function SwatchCard({
  element,
  editing,
}: {
  element: Element;
  editing?: boolean;
}) {
  const c = element.content as SwatchContent;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="relative min-h-12 flex-1" style={{ background: c.hex }}>
        {editing && (
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-black/45 p-2 backdrop-blur-sm"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ColorPicker element={element} hex={c.hex} />
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Set color ${hex}`}
                  title={hex}
                  onClick={() => commitSwatch(element, { hex }, 'Change color')}
                  className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                    c.hex.toLowerCase() === hex.toLowerCase()
                      ? 'border-white ring-2 ring-white'
                      : 'border-white/50'
                  }`}
                  style={{ background: hex }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 px-2 py-1.5 text-xs text-ink-soft">
        {editing ? (
          <>
            <input
              value={c.label ?? ''}
              placeholder="Name"
              aria-label="Swatch name"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => commitSwatch(element, { label: e.target.value }, 'Edit label')}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') useStore.getState().setEditing(null);
              }}
              className="w-full bg-transparent font-medium text-ink outline-none"
            />
            <input
              value={c.caption ?? ''}
              placeholder="Caption"
              aria-label="Swatch caption"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => commitSwatch(element, { caption: e.target.value }, 'Edit caption')}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') useStore.getState().setEditing(null);
              }}
              className="w-full bg-transparent outline-none"
            />
            <div className="flex gap-0.5">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-label={`Show ${f}`}
                  onClick={() => commitSwatch(element, { format: f }, 'Change format')}
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                    (c.format ?? 'hex') === f
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-soft hover:bg-panel-border/60'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {c.label && <span className="block truncate font-medium text-ink">{c.label}</span>}
            {(c.format ?? 'hex') !== 'off' && (
              <span className="block truncate">{formatColor(c.hex, c.format)}</span>
            )}
            {c.caption && <span className="block truncate text-ink-soft/80">{c.caption}</span>}
          </>
        )}
      </div>
    </div>
  );
});
