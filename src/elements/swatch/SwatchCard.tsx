import { memo } from 'react';
import { useStore } from '@/store';
import type { Element, SwatchContent } from '@/db/types';

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
          <input
            type="color"
            aria-label="Swatch color"
            value={c.hex}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => commitSwatch(element, { hex: e.target.value }, 'Change color')}
            className="absolute inset-2 h-8 w-12 cursor-pointer rounded border border-white/60 bg-transparent"
          />
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
