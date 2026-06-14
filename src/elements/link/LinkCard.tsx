import { memo } from 'react';
import { Globe } from 'lucide-react';
import type { Element, LinkContent } from '@/db/types';
import { useAssetUrl } from '../image/ImageCard';

export const LinkCard = memo(function LinkCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as LinkContent;
  const faviconUrl = useAssetUrl(c.faviconAssetId);
  const previewUrl = useAssetUrl(c.previewAssetId);

  let host = c.url;
  try {
    host = new URL(c.url).hostname.replace(/^www\./, '');
  } catch {
    // keep raw url
  }
  // Synced/imported content is untrusted — never render a non-http(s) href.
  const safeHref = /^https?:\/\//i.test(c.url) ? c.url : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {previewUrl && (
        <img
          src={previewUrl}
          alt=""
          draggable={false}
          className="h-24 w-full select-none object-cover"
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2.5">
        <div className="truncate text-sm font-medium">
          {c.title || host}
        </div>
        {c.description && (
          <div className="line-clamp-2 text-xs text-ink-soft">{c.description}</div>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          {faviconUrl ? (
            <img src={faviconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" />
          ) : (
            <Globe className="h-3.5 w-3.5 text-ink-soft" />
          )}
          <a
            href={safeHref}
            target="_blank"
            rel="noreferrer noopener"
            onPointerDown={(e) => e.stopPropagation()}
            className="truncate text-xs text-ink-soft hover:text-accent hover:underline"
          >
            {host}
          </a>
        </div>
      </div>
    </div>
  );
});
