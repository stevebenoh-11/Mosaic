import { memo } from 'react';
import type { Element, SwatchContent } from '@/db/types';

export const SwatchCard = memo(function SwatchCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as SwatchContent;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-12 flex-1" style={{ background: c.hex }} />
      <div className="truncate px-2 py-1.5 text-xs text-ink-soft">
        {c.label ? `${c.label} · ` : ''}
        {c.hex.toUpperCase()}
      </div>
    </div>
  );
});
