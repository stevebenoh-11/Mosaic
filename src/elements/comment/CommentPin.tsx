import { memo, useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Check, MessageCircle, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import type { Element, CommentContent, TipTapDoc } from '@/db/types';
import { noteExtensions } from '../note/extensions';
import { deleteElementsCmd } from '@/store/elementCommands';

/** Comment content may carry an attachment to an element (decision: M2). */
export interface CommentContentEx extends CommentContent {
  targetElementId?: string;
  offsetX?: number;
  offsetY?: number;
}

/** World position of a pin: element-attached pins follow their element. */
export function commentPosition(
  comment: Element,
  elements: Record<string, Element>,
): { x: number; y: number } {
  const c = comment.content as CommentContentEx;
  if (c.targetElementId) {
    const target = elements[c.targetElementId];
    if (target) {
      return {
        x: target.x + (c.offsetX ?? target.w),
        y: target.y + (c.offsetY ?? 0),
      };
    }
  }
  return { x: comment.x, y: comment.y };
}

const EXTENSIONS = noteExtensions('Write a comment…');

function CommentEditor({ element }: { element: Element }) {
  const execute = useStore((s) => s.execute);
  const content = element.content as CommentContentEx;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Commit the new doc onto the LATEST element from the store, not a snapshot
  // taken at mount — otherwise toggling "resolved" while the editor is open
  // gets clobbered back on the next keystroke. Returns true if it committed.
  function commitDoc(doc: TipTapDoc): boolean {
    const before = useStore.getState().elements[element.id];
    if (!before) return false;
    const bc = before.content as CommentContentEx;
    if (JSON.stringify(bc.doc) === JSON.stringify(doc)) return false;
    execute({
      label: 'Edit comment',
      coalesceKey: `edit:${element.id}`,
      changes: [
        {
          entity: 'element',
          id: element.id,
          before,
          after: { ...before, content: { ...bc, doc } },
        },
      ],
    });
    return true;
  }

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: content.doc as object,
    autofocus: 'end',
    onUpdate({ editor }) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        commitDoc(editor.getJSON() as TipTapDoc);
      }, 300);
    },
  });

  // Flush a pending debounced edit on unmount so a comment closed within the
  // 300ms debounce window doesn't lose its last keystrokes (matches NoteCard).
  useEffect(() => {
    return () => {
      if (!debounceRef.current) return;
      clearTimeout(debounceRef.current);
      if (editor && !editor.isDestroyed) {
        commitDoc(editor.getJSON() as TipTapDoc);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;
  return <EditorContent editor={editor} className="note-prose text-sm" />;
}

export const CommentPin = memo(function CommentPin({
  element,
  elements,
  open,
  onOpen,
}: {
  element: Element;
  elements: Record<string, Element>;
  open: boolean;
  onOpen: (id: string | null) => void;
}) {
  const c = element.content as CommentContentEx;
  const pos = commentPosition(element, elements);
  const execute = useStore((s) => s.execute);
  const setSelection = useStore((s) => s.setSelection);

  function toggleResolved() {
    const state = useStore.getState();
    const before = state.elements[element.id];
    if (!before) return;
    const bc = before.content as CommentContentEx;
    const after: Element = {
      ...before,
      content: { ...bc, resolved: !bc.resolved },
    };
    execute({
      label: bc.resolved ? 'Reopen comment' : 'Resolve comment',
      changes: [{ entity: 'element', id: element.id, before, after }],
    });
  }

  function remove() {
    onOpen(null);
    setSelection([]);
    execute(deleteElementsCmd([element]));
  }

  return (
    <div
      className="absolute"
      style={{ left: pos.x, top: pos.y, zIndex: 90000 }}
      data-element-id={element.id}
    >
      <button
        aria-label={c.resolved ? 'Resolved comment' : 'Comment'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onOpen(open ? null : element.id)}
        className={`flex h-8 w-8 items-center justify-center rounded-full rounded-bl-none border shadow-card ${
          c.resolved
            ? 'border-card-border bg-panel text-ink-soft'
            : 'border-accent bg-accent text-white'
        }`}
      >
        {c.resolved ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
      </button>

      {open && (
        <div
          className="absolute left-10 top-0 w-64 rounded-lg border border-card-border bg-card p-3 shadow-card-drag"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-soft">{c.authorName}</span>
            <div className="flex gap-1">
              <button
                aria-label={c.resolved ? 'Reopen' : 'Resolve'}
                title={c.resolved ? 'Reopen' : 'Resolve'}
                onClick={toggleResolved}
                className={`rounded p-1 ${c.resolved ? 'text-accent' : 'text-ink-soft hover:text-ink'}`}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label="Delete comment"
                title="Delete"
                onClick={remove}
                className="rounded p-1 text-ink-soft hover:text-ink"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <CommentEditor element={element} />
        </div>
      )}
    </div>
  );
});
