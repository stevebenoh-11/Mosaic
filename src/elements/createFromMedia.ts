import { useStore } from '@/store';
import { saveAsset } from '@/db/assets';
import { buildElement } from '@/store/elementCommands';
import type { Element, LinkContent } from '@/db/types';

function maxZOf(boardId: string): number {
  const els = Object.values(useStore.getState().elements).filter(
    (e) => e.boardId === boardId,
  );
  return Math.max(0, ...els.map((e) => e.zIndex));
}

function createAndSelect(el: Element, label: string, coalesceKey?: string) {
  const state = useStore.getState();
  const cmd = {
    label,
    changes: [{ entity: 'element' as const, id: el.id, before: null, after: el }],
    ...(coalesceKey ? { coalesceKey } : {}),
  };
  state.execute(cmd);
  state.setSelection([el.id]);
}

const MAX_IMG_W = 320;

export async function createImageElement(
  boardId: string,
  blob: Blob,
  name: string,
  world: { x: number; y: number },
): Promise<string | null> {
  if (!blob.type.startsWith('image/')) return null;
  const asset = await saveAsset(blob, name);
  const natW = asset.width ?? 200;
  const natH = asset.height ?? 150;
  const w = Math.min(MAX_IMG_W, natW || MAX_IMG_W);
  const h = natW > 0 ? Math.round((w / natW) * natH) : 150;
  const el = buildElement(boardId, 'image', world.x, world.y, maxZOf(boardId) + 1, {
    w,
    h,
    content: { assetId: asset.id, naturalW: natW, naturalH: natH },
  });
  createAndSelect(el, 'Add image');
  return el.id;
}

export const URL_RE = /^https?:\/\/[^\s]+$/i;

export function createLinkElement(
  boardId: string,
  url: string,
  world: { x: number; y: number },
): string {
  const el = buildElement(boardId, 'link', world.x, world.y, maxZOf(boardId) + 1, {
    content: { url },
  });
  createAndSelect(el, 'Add link', `link:${el.id}`);
  void enrichLink(el.id, url);
  return el.id;
}

/**
 * Best-effort client-side metadata. Most sites block cross-origin reads —
 * that's fine, the card falls back to domain + URL. Favicon comes from
 * DuckDuckGo's public icon endpoint and is cached as a local asset.
 */
async function enrichLink(elementId: string, url: string): Promise<void> {
  const patch: Partial<LinkContent> = {};

  try {
    const res = await fetch(url, {
      mode: 'cors',
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const meta = (sel: string) =>
        doc.querySelector(sel)?.getAttribute('content')?.trim();
      patch.title =
        meta('meta[property="og:title"]') ??
        meta('meta[name="twitter:title"]') ??
        doc.title?.trim() ??
        undefined;
      patch.description =
        meta('meta[property="og:description"]') ??
        meta('meta[name="description"]') ??
        undefined;
    }
  } catch {
    // CORS or network failure — the card falls back to domain + URL.
    // (No favicon service either: public favicon endpoints are CORS-blocked
    // for reads, so we render a generic globe icon instead — see DECISIONS.)
  }

  if (Object.keys(patch).length === 0) return;
  const state = useStore.getState();
  const before = state.elements[elementId];
  if (!before || before.type !== 'link') return; // deleted/changed meanwhile
  const after: Element = {
    ...before,
    content: { ...(before.content as LinkContent), ...patch },
  };
  state.execute({
    label: 'Fetch link details',
    coalesceKey: `link:${elementId}`,
    changes: [{ entity: 'element', id: elementId, before, after }],
  });
}
