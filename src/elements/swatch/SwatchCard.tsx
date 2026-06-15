import { memo } from 'react';
import { useStore } from '@/store';
import type { Element, SwatchContent } from '@/db/types';

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
            className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-black/35 p-1.5 backdrop-blur-sm"
            onPointerDown={(e) => e.stopPropagation()}
          >
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
            <label className="flex items-center gap-1.5 text-[10px] font-medium text-white/90">
              Custom
              <input
                type="color"
                aria-label="Swatch color"
                value={c.hex}
                onChange={(e) => commitSwatch(element, { hex: e.target.value }, 'Change color')}
                className="h-5 w-7 cursor-pointer rounded border border-white/60 bg-transparent"
              />
            </label>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 text-xs text-ink-soft">
        {editing ? (
          <input
            value={c.label ?? ''}
            placeholder="Label"
            aria-label="Swatch label"
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => commitSwatch(element, { label: e.target.value }, 'Edit label')}
            onBlur={() => useStore.getState().setEditing(null)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') {
                useStore.getState().setEditing(null);
              }
            }}
            className="w-full bg-transparent outline-none"
          />
        ) : (
          <span className="block truncate">
            {c.label ? `${c.label} · ` : ''}
            {c.hex.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
});
