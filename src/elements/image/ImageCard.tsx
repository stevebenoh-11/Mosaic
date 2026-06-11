import { memo, useEffect, useState } from 'react';
import { CloudUpload, ImageOff } from 'lucide-react';
import { liveQuery } from 'dexie';
import { getAssetUrl } from '@/db/assets';
import { db } from '@/db/schema';
import { useSyncStore } from '@/sync/status';
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

/** True while the asset exists locally but hasn't reached Drive yet. */
function useUploadPending(assetId: string | undefined): boolean {
  const connected = useSyncStore((s) => s.connected);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!assetId || !connected) {
      setPending(false);
      return;
    }
    const sub = liveQuery(() => db.assets.get(assetId)).subscribe({
      next: (asset) => setPending(!!asset && !asset.driveFileId),
      error: () => setPending(false),
    });
    return () => sub.unsubscribe();
  }, [assetId, connected]);
  return pending;
}

export const ImageCard = memo(function ImageCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as ImageContent;
  const url = useAssetUrl(c.assetId || undefined);
  const uploadPending = useUploadPending(c.assetId || undefined);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {uploadPending && (
        <span
          title="Waiting to upload to Drive"
          className="absolute bottom-1.5 right-1.5 z-10 rounded-full bg-ink/50 p-1 text-white"
        >
          <CloudUpload className="h-3 w-3" />
        </span>
      )}
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
