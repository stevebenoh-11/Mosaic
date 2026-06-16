import { memo } from 'react';
import { FileText } from 'lucide-react';
import type { DocumentContent, Element } from '@/db/types';
import { docText, wordCount } from '@/ui/searchText';

/**
 * Card-view of a document: title, a short text preview and a word count.
 * The full rich-text body is edited in the expanded DocumentModal (opened by
 * double-click or the selection toolbar's "Open" action).
 */
export const DocumentCard = memo(function DocumentCard({
  element,
}: {
  element: Element;
  editing?: boolean;
}) {
  const c = element.content as DocumentContent;
  const words = wordCount(c.doc);
  const preview = docText(c.doc).trim().slice(0, 160);

  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
        <span className="truncate text-sm font-semibold">
          {c.title || 'Untitled document'}
        </span>
      </div>
      {preview ? (
        <p className="line-clamp-3 whitespace-pre-wrap text-xs text-ink-soft">
          {preview}
        </p>
      ) : (
        <p className="text-xs italic text-ink-soft/60">Start typing…</p>
      )}
      <div className="mt-auto pt-1 text-[10px] uppercase tracking-wider text-ink-soft">
        {words} {words === 1 ? 'word' : 'words'} · Document
      </div>
    </div>
  );
});
