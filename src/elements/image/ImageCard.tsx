import { memo, useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { getAssetUrl } from '@/db/assets';
import type { Element, ImageContent } from '@/db/types';

export function useAssetUrl(assetId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!assetId) {
      setUrl(null);
      return;
    }
    void getAssetUrl(assetId).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [assetId]);
  return url;
}

export const ImageCard = memo(function ImageCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as ImageContent;
  const url = useAssetUrl(c.assetId || undefined);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {url ? (
        <img
          src={url}
          alt={c.caption ?? 'Image'}
          draggable={false}
          className="h-full w-full select-none object-cover"
        />
      ) : (
        <div className="flex h-full min-h-20 items-center justify-center text-ink-soft">
          <ImageOff className="h-6 w-6" />
        </div>
      )}
      {c.caption && (
        <div className="truncate px-2 py-1.5 text-xs text-ink-soft">
          {c.caption}
        </div>
      )}
    </div>
  );
});
