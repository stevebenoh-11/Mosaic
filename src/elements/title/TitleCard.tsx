import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { updateElementsCmd } from '@/store/elementCommands';
import type { Element, TitleContent } from '@/db/types';

export const TitleCard = memo(function TitleCard({
  element,
  editing,
}: {
  element: Element;
  editing: boolean;
}) {
  const execute = useStore((s) => s.execute);
  const setEditing = useStore((s) => s.setEditing);
  const content = element.content as TitleContent;
  const [draft, setDraft] = useState(content.text);
  const lastCommitted = useRef(element);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft((lastCommitted.current.content as TitleContent).text);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit(text: string) {
    const before = lastCommitted.current;
    if ((before.content as TitleContent).text === text) return;
    const after: Element = { ...before, content: { text } };
    lastCommitted.current = after;
    execute(
      updateElementsCmd('Edit title', [before], [after], `edit:${element.id}`),
    );
  }

  if (!editing) {
    return (
      <h1 className="select-none whitespace-pre-wrap break-words text-3xl font-bold tracking-tight">
        {content.text || <span className="text-ink-soft/60">Title</span>}
      </h1>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      placeholder="Title"
      aria-label="Title text"
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => setEditing(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setEditing(null);
        }
      }}
      className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-ink-soft/60"
    />
  );
});
