import { db } from './schema';
import { newId } from './ids';
import type { Asset } from './types';

/** Probe intrinsic dimensions of an image blob (0×0 for non-images). */
export async function probeImageSize(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  if (!blob.type.startsWith('image/')) return { width: 0, height: 0 };
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function saveAsset(blob: Blob, name: string): Promise<Asset> {
  const { width, height } = await probeImageSize(blob);
  const asset: Asset = {
    id: newId(),
    blob,
    mime: blob.type || 'application/octet-stream',
    name,
    size: blob.size,
    width: width || undefined,
    height: height || undefined,
  };
  await db.assets.put(asset);
  await db.outbox.add({
    entityType: 'asset',
    entityId: asset.id,
    boardId: null,
    queuedAt: Date.now(),
  });
  return asset;
}

// Object-URL cache so every card render doesn't re-create blob URLs.
const urlCache = new Map<string, string>();

export async function getAssetUrl(assetId: string): Promise<string | null> {
  const cached = urlCache.get(assetId);
  if (cached) return cached;
  const asset = await db.assets.get(assetId);
  if (!asset) return null;
  const url = URL.createObjectURL(asset.blob);
  urlCache.set(assetId, url);
  return url;
}
