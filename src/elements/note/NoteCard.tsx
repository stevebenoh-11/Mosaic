import { memo, useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateHTML } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { useStore } from '@/store';
import { updateElementsCmd } from '@/store/elementCommands';
import type { Element, NoteContent, TipTapDoc } from '@/db/types';
import { noteExtensions } from './extensions';
import { BubbleToolbar } from './BubbleToolbar';

const EXTENSIONS = noteExtensions();

function StaticNote({ doc }: { doc: TipTapDoc }) {
  const html = useMemo(() => {
    try {
      // Sanitize: note docs can arrive from sync or backup import, so the
      // TipTap JSON is untrusted (e.g. javascript: hrefs injected into marks).
      return DOMPurify.sanitize(
        generateHTML(doc as Parameters<typeof generateHTML>[0], EXTENSIONS),
        { USE_PROFILES: { html: true } },
      );
    } catch {
      return '';
    }
  }, [doc]);
  return (
    <div
      className="note-prose pointer-events-none select-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function NoteEditor({ element }: { element: Element }) {
  const execute = useStore((s) => s.execute);
  const setEditing = useStore((s) => s.setEditing);
  const content = element.content as NoteContent;
  /** Last committed snapshot — `before` for the next coalesced command. */
  const lastCommitted = useRef<Element>(element);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: content.doc as Parameters<typeof generateHTML>[0],
    autofocus: 'end',
    onUpdate({ editor }) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const doc = editor.getJSON() as TipTapDoc;
        const before = lastCommitted.current;
        const after: Element = { ...before, content: { doc } };
        lastCommitted.current = after;
        execute(
          updateElementsCmd('Edit note', [before], [after], `edit:${element.id}`),
        );
      }, 300);
    },
  });

  // Flush pending edits when the editor unmounts (Esc, click-away, undo).
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        if (editor && !editor.isDestroyed) {
          const doc = editor.getJSON() as TipTapDoc;
          const before = lastCommitted.current;
          if (JSON.stringify((before.content as NoteContent).doc) !== JSON.stringify(doc)) {
            execute(
              updateElementsCmd(
                'Edit note',
                [before],
                [{ ...before, content: { doc } }],
                `edit:${element.id}`,
              ),
            );
          }
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  return (
    <div
      className="relative"
      onPointerDown={(e) => e.stopPropagation()}
      onFocusCapture={() => undefined}
      onBlur={(e) => {
        // Exit edit mode unless focus moved within the card (e.g. toolbar).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setEditing(null);
        }
      }}
    >
      <BubbleToolbar editor={editor} />
      <EditorContent editor={editor} className="note-prose" />
    </div>
  );
}

export const NoteCard = memo(function NoteCard({
  element,
  editing,
}: {
  element: Element;
  editing: boolean;
}) {
  const content = element.content as NoteContent;
  return (
    <div className="px-3 py-2.5 text-sm">
      {editing ? (
        <NoteEditor element={element} />
      ) : (
        <StaticNote doc={content.doc} />
      )}
    </div>
  );
});
