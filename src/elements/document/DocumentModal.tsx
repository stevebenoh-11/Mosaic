import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { X } from 'lucide-react';
import { useStore } from '@/store';
import { useUiStore } from '@/ui/uiStore';
import { updateElementsCmd } from '@/store/elementCommands';
import { noteExtensions } from '@/elements/note/extensions';
import { BubbleToolbar } from '@/elements/note/BubbleToolbar';
import { wordCount } from '@/ui/searchText';
import type { DocumentContent, Element, TipTapDoc } from '@/db/types';

const EXTENSIONS = noteExtensions('Start typing…');

/** Full-screen expanded editor for the open document (uiStore.openDocumentId). */
export function DocumentModal() {
  const openId = useUiStore((s) => s.openDocumentId);
  const setOpen = useUiStore((s) => s.setOpenDocumentId);
  const element = useStore((s) => (openId ? s.elements[openId] : undefined));

  if (!openId || !element || element.type !== 'document') return null;
  return (
    <DocumentEditor
      key={openId}
      element={element}
      onClose={() => {
        useStore.getState().breakCoalescing();
        setOpen(null);
      }}
    />
  );
}

function DocumentEditor({
  element,
  onClose,
}: {
  element: Element;
  onClose: () => void;
}) {
  const execute = useStore((s) => s.execute);
  const content = element.content as DocumentContent;
  const [title, setTitle] = useState(content.title);
  const [words, setWords] = useState(() => wordCount(content.doc));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Commit onto the latest store element so title + body edits don't clobber. */
  function commit(patch: Partial<DocumentContent>) {
    const before = useStore.getState().elements[element.id];
    if (!before) return;
    const bc = before.content as DocumentContent;
    const after: Element = { ...before, content: { ...bc, ...patch } };
    execute(updateElementsCmd('Edit document', [before], [after], `editdoc:${element.id}`));
  }

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: content.doc as object,
    autofocus: 'end',
    onUpdate({ editor }) {
      const doc = editor.getJSON() as TipTapDoc;
      setWords(wordCount(doc));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => commit({ doc }), 300);
    },
  });

  // Flush any pending edit when the editor unmounts (close / Esc).
  useEffect(() => {
    return () => {
      if (debounceRef.current && editor && !editor.isDestroyed) {
        clearTimeout(debounceRef.current);
        commit({ doc: editor.getJSON() as TipTapDoc });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="safe-area relative flex h-full max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-card-drag">
        <div className="flex items-center gap-2 border-b border-card-border px-4 py-2.5">
          <input
            value={title}
            placeholder="New Document"
            aria-label="Document title"
            onChange={(e) => {
              setTitle(e.target.value);
              commit({ title: e.target.value });
            }}
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-ink-soft/50"
          />
          <span className="shrink-0 text-xs text-ink-soft">
            {words} {words === 1 ? 'word' : 'words'}
          </span>
          <button
            aria-label="Close document"
            onClick={onClose}
            className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {editor && <BubbleToolbar editor={editor} floating={false} />}
          <EditorContent editor={editor} className="note-prose text-sm" />
        </div>
      </div>
    </div>
  );
}
