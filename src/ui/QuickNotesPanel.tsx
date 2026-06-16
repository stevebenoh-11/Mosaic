import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, Trash2, X } from 'lucide-react';
import { useStore } from '@/store';
import { db, getMeta } from '@/db/schema';
import type { Board, Element, NoteContent } from '@/db/types';
import { buildElement, createElementCmd, deleteElementsCmd } from '@/store/elementCommands';
import { moveElementsToBoardCmd } from '@/store/boardCommands';
import { docText } from './searchText';
import { ensureInboxBoard } from './QuickCapture';
import { useUiStore } from './uiStore';

export function QuickNotesPanel() {
  const open = useUiStore((s) => s.quickNotesOpen);
  const setOpen = useUiStore((s) => s.setQuickNotesOpen);
  const boards = useStore((s) => s.boards);
  const execute = useStore((s) => s.execute);
  const navigate = useNavigate();

  const [inboxId, setInboxId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Element[]>([]);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    await useStore.getState().flushNow();
    const id = (await getMeta<string>('inboxBoardId')) ?? null;
    setInboxId(id);
    if (!id) {
      setNotes([]);
      return;
    }
    const rows = await db.elements.where('boardId').equals(id).toArray();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    setNotes(rows);
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const destinations = Object.values(boards)
    .filter((b) => b.id !== inboxId)
    .sort((a, b) => a.title.localeCompare(b.title));

  async function ensureInbox(): Promise<string> {
    if (inboxId) return inboxId;
    // Reuse the same Inbox board QuickCapture creates.
    const id = await ensureInboxBoard();
    setInboxId(id);
    return id;
  }

  async function addNote() {
    const text = draft.trim();
    if (!text) return;
    const target = await ensureInbox();
    const rows = await db.elements.where('boardId').equals(target).toArray();
    const maxY = Math.max(80, ...rows.map((r) => r.y + r.h));
    const maxZ = Math.max(0, ...rows.map((r) => r.zIndex));
    const content: NoteContent = {
      doc: {
        type: 'doc',
        content: text.split(/\n+/).map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : undefined,
        })),
      },
    };
    const el = buildElement(target, 'note', 120, maxY + 40, maxZ + 1, { content });
    execute(createElementCmd(el));
    setDraft('');
    void refresh();
  }

  function moveNote(note: Element, boardId: string) {
    // The inbox elements usually aren't in the open-board store, so pass the
    // panel's own loaded snapshot — lets the command carry any dependents.
    const inboxMap = Object.fromEntries(notes.map((n) => [n.id, n]));
    execute(moveElementsToBoardCmd([note], inboxMap, boardId));
    void refresh();
  }

  function deleteNote(note: Element) {
    execute(deleteElementsCmd([note]));
    void refresh();
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-hidden />
      <div className="safe-area relative flex h-full max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-card-drag">
        <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">Quick Notes</span>
            <span className="rounded-full bg-panel-border px-1.5 text-[11px] text-ink-soft">
              {notes.length} unsorted
            </span>
          </div>
          <button
            aria-label="Close quick notes"
            onClick={() => setOpen(false)}
            className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-card-border px-4 py-3">
          <p className="mb-2 text-xs text-ink-soft">
            Don&apos;t want to choose a board? Add quick notes here and sort them out later.
          </p>
          <textarea
            value={draft}
            placeholder="Start typing…"
            aria-label="Quick note"
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void addNote();
            }}
            className="w-full resize-none rounded-md border border-card-border bg-panel px-2.5 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => void addNote()}
              disabled={!draft.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Add note
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {notes.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-soft">
              No unsorted notes. Captured notes will appear here.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => (
                <QuickNoteRow
                  key={note.id}
                  note={note}
                  destinations={destinations}
                  onMove={(bid) => moveNote(note, bid)}
                  onDelete={() => deleteNote(note)}
                  onOpen={() => {
                    if (inboxId) navigate(`/b/${inboxId}`);
                    setOpen(false);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickNoteRow({
  note,
  destinations,
  onMove,
  onDelete,
  onOpen,
}: {
  note: Element;
  destinations: Board[];
  onMove: (boardId: string) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const doc = (note.content as NoteContent | undefined)?.doc;
  const text = doc ? docText(doc).trim() : '';
  return (
    <li className="rounded-lg border border-card-border bg-panel p-2.5">
      <button onClick={onOpen} className="block w-full text-left">
        <p className="line-clamp-3 whitespace-pre-wrap text-sm">
          {text || <span className="italic text-ink-soft/60">Empty note</span>}
        </p>
      </button>
      <div className="mt-2 flex items-center gap-2">
        <select
          aria-label="Move to board"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onMove(e.target.value);
          }}
          className="min-w-0 flex-1 rounded-md border border-card-border bg-card px-2 py-1 text-xs outline-none"
        >
          <option value="" disabled>
            Move to board…
          </option>
          {destinations.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title || 'Untitled board'}
            </option>
          ))}
        </select>
        <button
          aria-label="Delete note"
          onClick={onDelete}
          className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
