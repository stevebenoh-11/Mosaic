import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Image as ImageIcon, Inbox, Link2, Plus, StickyNote, X } from 'lucide-react';
import { useStore } from '@/store';
import { db, getMeta, setMeta } from '@/db/schema';
import { newId } from '@/db/ids';
import type { Board } from '@/db/types';
import { buildElement } from '@/store/elementCommands';
import { createImageElement, createLinkElement, URL_RE } from '@/elements/createFromMedia';
import { screenToWorld } from '@/canvas/coords';

/** Find or create the pinned "Inbox" board (id remembered in meta). */
async function ensureInboxBoard(): Promise<string> {
  const existing = await getMeta<string>('inboxBoardId');
  if (existing && useStore.getState().boards[existing]) return existing;
  const found = Object.values(useStore.getState().boards).find(
    (b) => b.parentBoardId === null && b.title === 'Inbox',
  );
  if (found) {
    await setMeta('inboxBoardId', found.id);
    return found.id;
  }
  const now = Date.now();
  const board: Board = {
    id: newId(),
    title: 'Inbox',
    parentBoardId: null,
    sortIndex: -1, // pinned to the top
    createdAt: now,
    updatedAt: now,
  };
  useStore.getState().execute({
    label: 'Create Inbox',
    changes: [{ entity: 'board', id: board.id, before: null, after: board }],
  });
  await setMeta('inboxBoardId', board.id);
  return board.id;
}

async function freeSpot(boardId: string): Promise<{ x: number; y: number }> {
  const state = useStore.getState();
  if (state.currentBoardId === boardId) {
    const canvas = document.querySelector('[data-testid="canvas"]');
    const rect = canvas?.getBoundingClientRect();
    const local = rect
      ? { x: rect.width / 2 - 100, y: rect.height / 2 - 60 }
      : { x: 200, y: 200 };
    return screenToWorld(local, state.viewport);
  }
  // Other board: stack below its existing content.
  const rows = await db.elements.where('boardId').equals(boardId).toArray();
  const maxY = Math.max(80, ...rows.map((r) => r.y + r.h));
  return { x: 120, y: maxY + 40 };
}

async function maxZOf(boardId: string): Promise<number> {
  const rows = await db.elements.where('boardId').equals(boardId).toArray();
  return Math.max(0, ...rows.map((r) => r.zIndex));
}

/** Mobile floating quick-capture: note / photo / library / link. */
export function QuickCapture({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [toInbox, setToInbox] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function targetBoard(): Promise<string> {
    return toInbox ? ensureInboxBoard() : boardId;
  }

  async function addNote() {
    setOpen(false);
    const target = await targetBoard();
    const spot = await freeSpot(target);
    const el = buildElement(target, 'note', spot.x, spot.y, (await maxZOf(target)) + 1);
    const state = useStore.getState();
    state.execute({
      label: 'Quick note',
      changes: [{ entity: 'element', id: el.id, before: null, after: el }],
    });
    if (target !== state.currentBoardId) navigate(`/b/${target}`);
    // Element is on the (possibly newly opened) board; edit it.
    setTimeout(() => {
      useStore.getState().setSelection([el.id]);
      useStore.getState().setEditing(el.id);
    }, 150);
  }

  async function addFiles(files: FileList | null) {
    setOpen(false);
    if (!files || files.length === 0) return;
    const target = await targetBoard();
    const spot = await freeSpot(target);
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      await createImageElement(target, f, f.name || 'photo', {
        x: spot.x + i * 24,
        y: spot.y + i * 24,
      });
    }
    const state = useStore.getState();
    if (target !== state.currentBoardId) navigate(`/b/${target}`);
  }

  async function addLink() {
    setOpen(false);
    const url = window.prompt('Link URL', 'https://');
    if (!url || !URL_RE.test(url.trim())) return;
    const target = await targetBoard();
    const spot = await freeSpot(target);
    createLinkElement(target, url.trim(), spot);
    const state = useStore.getState();
    if (target !== state.currentBoardId) navigate(`/b/${target}`);
  }

  return (
    <div className="absolute bottom-20 right-3 z-40 sm:hidden">
      {open && (
        <div
          className="fixed inset-0"
          aria-hidden
          onPointerDown={() => setOpen(false)}
        />
      )}
      {open && (
        <div className="absolute bottom-14 right-0 w-52 rounded-xl border border-card-border bg-card p-1.5 shadow-card-drag">
          <button
            onClick={() => setToInbox((v) => !v)}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-soft hover:bg-panel-border/40"
            aria-label="Toggle capture destination"
          >
            <Inbox className={`h-4 w-4 ${toInbox ? 'text-accent' : ''}`} />
            Add to: <b>{toInbox ? 'Inbox' : 'this board'}</b>
          </button>
          <div className="border-t border-card-border pt-1">
            <CaptureItem icon={StickyNote} label="Note" onClick={() => void addNote()} />
            <CaptureItem icon={Camera} label="Take photo" onClick={() => cameraRef.current?.click()} />
            <CaptureItem icon={ImageIcon} label="Photo library" onClick={() => libraryRef.current?.click()} />
            <CaptureItem icon={Link2} label="Link" onClick={() => void addLink()} />
          </div>
        </div>
      )}
      <button
        aria-label={open ? 'Close quick capture' : 'Quick capture'}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-card-drag active:scale-95"
      >
        {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
      </button>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take photo"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label="Choose photos"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function CaptureItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-panel-border/40"
    >
      <Icon className="h-4 w-4 text-ink-soft" /> {label}
    </button>
  );
}
