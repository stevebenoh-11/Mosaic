import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Columns2,
  Copy,
  CopyPlus,
  Lock,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Palette,
  Pencil,
  Scissors,
  Smile,
  Tag,
  Text,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useStore } from '@/store';
import { useUiStore } from './uiStore';
import type { Viewport } from '@/store';
import type {
  Element,
  ImageContent,
  LinkContent,
  SwatchContent,
  TodoContent,
} from '@/db/types';
import {
  buildElement,
  createElementCmd,
  deleteElementsCmd,
  duplicateElementsCmd,
  groupIntoColumnCmd,
  updateElementsCmd,
  updateStyleCmd,
  withDependents,
  zOrderCmd,
} from '@/store/elementCommands';
import { renameBoardCmd } from '@/store/boardCommands';
import { cloneElements } from '@/store/boardCommands';
import { boundingBox, elementRect, worldToScreen } from '@/canvas/coords';

const COLOR_PRESETS = [
  '#FFFFFF', '#FEE2E2', '#FFEDD5', '#FEF9C3', '#DCFCE7',
  '#CCFBF1', '#DBEAFE', '#E7E3FB', '#F3E8FF', '#FCE7F3',
];
const REACTION_EMOJI = ['👍', '❤️', '🎉', '😄', '🚀', '👀', '✅', '🔥'];

const RENAMEABLE = new Set([
  'note', 'title', 'swatch', 'column', 'document', 'link', 'boardLink', 'todo',
]);
const CAPTIONABLE = new Set(['image', 'link', 'swatch']);

type Popover = 'color' | 'labels' | 'reactions' | 'caption' | 'more' | null;

/** Live snapshot of the currently-selected elements from the store. */
function freshSelected(): Element[] {
  const st = useStore.getState();
  return st.selection
    .map((id) => st.elements[id])
    .filter((e): e is Element => !!e);
}

function boardMaxZ(boardId: string): number {
  return Math.max(
    0,
    ...Object.values(useStore.getState().elements)
      .filter((e) => e.boardId === boardId)
      .map((e) => e.zIndex),
  );
}

export function SelectionToolbar({ viewport }: { viewport: Viewport }) {
  const selection = useStore((s) => s.selection);
  const elements = useStore((s) => s.elements);
  const editingId = useStore((s) => s.editingElementId);
  const execute = useStore((s) => s.execute);
  const setSelection = useStore((s) => s.setSelection);
  const setEditing = useStore((s) => s.setEditing);
  const [popover, setPopover] = useState<Popover>(null);
  const [labelDraft, setLabelDraft] = useState('');

  const selected = selection
    .map((id) => elements[id])
    .filter((e): e is Element => !!e);

  // Hidden while editing text, and when the only selection is a line (its own
  // LinePropertyBar handles it) or a single comment (handled by its pin).
  if (selected.length === 0 || editingId) return null;
  if (selected.length === 1 && (selected[0]!.type === 'line' || selected[0]!.type === 'comment')) {
    return null;
  }

  const positionable = selected.filter((e) => e.type !== 'line' && e.type !== 'comment');
  const bbox = boundingBox(positionable.map(elementRect));
  if (!bbox) return null;

  const topMid = worldToScreen({ x: bbox.x + bbox.w / 2, y: bbox.y }, viewport);
  const top = topMid.y - 46 < 8 ? topMid.y + bbox.h * viewport.scale + 12 : topMid.y - 46;

  const single = selected.length === 1 ? selected[0]! : null;
  const boardId = selected[0]!.boardId;

  // ---- actions ----

  function setColor(color: string | undefined) {
    execute(updateStyleCmd('Set color', freshSelected(), { color }));
  }

  function addLabel(text: string) {
    const t = text.trim();
    if (!t) return;
    const sel = freshSelected();
    execute({
      label: 'Add label',
      changes: sel.map((e) => ({
        entity: 'element' as const,
        id: e.id,
        before: e,
        after: { ...e, style: { ...e.style, labels: [...new Set([...(e.style.labels ?? []), t])] } },
      })),
    });
    setLabelDraft('');
  }

  function removeLabel(text: string) {
    const sel = freshSelected();
    execute({
      label: 'Remove label',
      changes: sel.map((e) => ({
        entity: 'element' as const,
        id: e.id,
        before: e,
        after: { ...e, style: { ...e.style, labels: (e.style.labels ?? []).filter((l) => l !== text) } },
      })),
    });
  }

  function addReaction(emoji: string) {
    const sel = freshSelected();
    execute({
      label: 'React',
      changes: sel.map((e) => {
        const next = { ...(e.style.reactions ?? {}) };
        next[emoji] = (next[emoji] ?? 0) + 1;
        return { entity: 'element' as const, id: e.id, before: e, after: { ...e, style: { ...e.style, reactions: next } } };
      }),
    });
  }

  function addComment() {
    if (!single) return;
    const target = useStore.getState().elements[single.id];
    if (!target) return;
    const el = buildElement(boardId, 'comment', target.x + target.w, target.y, boardMaxZ(boardId) + 1, {
      content: {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        authorName: 'You',
        resolved: false,
        createdAt: Date.now(),
        targetElementId: target.id,
        offsetX: target.w,
        offsetY: 0,
      } as Element['content'],
    });
    execute(createElementCmd(el));
    useUiStore.getState().setPendingCommentOpen(el.id);
  }

  function patchContent(el: Element, patch: Record<string, unknown>) {
    const before = useStore.getState().elements[el.id];
    if (!before) return;
    const after: Element = { ...before, content: { ...before.content, ...patch } };
    execute(updateElementsCmd('Edit', [before], [after], `inspect:${el.id}`));
  }

  function rename() {
    if (!single) return;
    if (['note', 'title', 'swatch', 'column'].includes(single.type)) {
      setEditing(single.id);
      return;
    }
    if (single.type === 'document') {
      useUiStore.getState().setOpenDocumentId(single.id);
      return;
    }
    if (single.type === 'boardLink') {
      const target = (single.content as { boardId: string }).boardId;
      const board = useStore.getState().boards[target];
      if (!board) return;
      const name = window.prompt('Board name', board.title);
      if (name !== null) execute(renameBoardCmd(board, name));
      return;
    }
    if (single.type === 'link') {
      const c = single.content as LinkContent;
      const title = window.prompt('Title', c.title ?? '');
      if (title !== null) patchContent(single, { title });
      return;
    }
    if (single.type === 'todo') {
      const c = single.content as TodoContent;
      const title = window.prompt('List title', c.title ?? '');
      if (title !== null) patchContent(single, { title });
    }
  }

  function captionValue(el: Element): string {
    if (el.type === 'image') return (el.content as ImageContent).caption ?? '';
    if (el.type === 'link') return (el.content as LinkContent).description ?? '';
    if (el.type === 'swatch') return (el.content as SwatchContent).caption ?? '';
    return '';
  }
  function setCaption(el: Element, value: string) {
    if (el.type === 'image') patchContent(el, { caption: value });
    else if (el.type === 'link') patchContent(el, { description: value });
    else if (el.type === 'swatch') patchContent(el, { caption: value });
  }

  function openExpanded() {
    if (!single) return;
    if (single.type === 'document') useUiStore.getState().setOpenDocumentId(single.id);
  }

  function copy(cut: boolean) {
    const full = withDependents(useStore.getState().elements, boardId, freshSelected());
    useUiStore.getState().setClipboard(full.map((el) => structuredClone(el)));
    if (cut) {
      execute(deleteElementsCmd(full));
      setSelection([]);
    }
    setPopover(null);
  }

  function paste() {
    const clip = useUiStore.getState().clipboard;
    if (!clip || clip.length === 0) return;
    const copies = cloneElements(clip, boardId, { x: 24, y: 24 }, boardMaxZ(boardId) + 1);
    execute({
      label: `Paste ${copies.length > 1 ? `${copies.length} elements` : 'element'}`,
      changes: copies.map((c) => ({ entity: 'element' as const, id: c.id, before: null, after: c })),
    });
    setSelection(copies.filter((c) => c.parentColumnId === null).map((c) => c.id));
    setPopover(null);
  }

  function duplicate() {
    const sel = freshSelected().filter((e) => e.type !== 'line');
    if (sel.length === 0) return;
    const { command, newIds } = duplicateElementsCmd(sel, 16);
    execute(command);
    setSelection(newIds);
    setPopover(null);
  }

  function group() {
    const res = groupIntoColumnCmd(freshSelected(), boardMaxZ(boardId));
    if (!res) return;
    execute(res.command);
    setSelection([res.columnId]);
    setPopover(null);
  }

  function toggleLock() {
    const sel = freshSelected();
    const lock = sel.some((e) => !e.style.locked);
    execute(updateStyleCmd(lock ? 'Lock' : 'Unlock', sel, { locked: lock }));
    setPopover(null);
  }

  function zOrder(dir: 'front' | 'back') {
    const sel = freshSelected();
    const siblings = Object.values(useStore.getState().elements).filter(
      (e) => e.boardId === boardId && e.parentColumnId === null,
    );
    const cmd = zOrderCmd(sel, siblings, dir);
    if (cmd) execute(cmd);
    setPopover(null);
  }

  function trash() {
    const full = withDependents(useStore.getState().elements, boardId, freshSelected());
    execute(deleteElementsCmd(full));
    setSelection([]);
    setPopover(null);
  }

  const anyLocked = selected.some((e) => e.style.locked);
  const btn =
    'flex items-center gap-1 rounded-md px-2 py-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink';

  return (
    <div
      className="absolute z-40 -translate-x-1/2"
      style={{ left: topMid.x, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-card-border bg-card px-1 py-0.5 text-sm shadow-card-drag">
        {!(single && single.type === 'swatch') && (
          <button className={btn} title="Color" aria-label="Color" onClick={() => setPopover(popover === 'color' ? null : 'color')}>
            <Palette className="h-4 w-4" />
          </button>
        )}
        <button className={btn} title="Labels" aria-label="Labels" onClick={() => setPopover(popover === 'labels' ? null : 'labels')}>
          <Tag className="h-4 w-4" />
        </button>
        <button className={btn} title="Reactions" aria-label="Reactions" onClick={() => setPopover(popover === 'reactions' ? null : 'reactions')}>
          <Smile className="h-4 w-4" />
        </button>
        {single && single.type !== 'comment' && (
          <button className={btn} title="Comment" aria-label="Comment" onClick={addComment}>
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        )}
        {single && RENAMEABLE.has(single.type) && (
          <button className={btn} title="Rename" aria-label="Rename" onClick={rename}>
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {single && CAPTIONABLE.has(single.type) && (
          <button className={btn} title="Caption" aria-label="Caption" onClick={() => setPopover(popover === 'caption' ? null : 'caption')}>
            <Text className="h-4 w-4" />
          </button>
        )}
        {single && single.type === 'document' && (
          <button className={btn} title="Open document" aria-label="Open document" onClick={openExpanded}>
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
        <button className={btn} title="More" aria-label="More" onClick={() => setPopover(popover === 'more' ? null : 'more')}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-card-border" />
        <button className={btn} title="Done" aria-label="Done" onClick={() => { setSelection([]); setPopover(null); }}>
          <Check className="h-4 w-4" />
        </button>
      </div>

      {popover === 'color' && (
        <Popout>
          <div className="flex flex-wrap gap-1.5">
            <button
              aria-label="No color"
              title="No color"
              onClick={() => setColor(undefined)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-card-border text-[10px] text-ink-soft"
            >
              ✕
            </button>
            {COLOR_PRESETS.map((hex) => (
              <button
                key={hex}
                aria-label={`Color ${hex}`}
                title={hex}
                onClick={() => setColor(hex)}
                className="h-6 w-6 rounded-full border border-card-border transition-transform hover:scale-110"
                style={{ background: hex }}
              />
            ))}
            <label className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-card-border" title="Custom color">
              <Palette className="h-3.5 w-3.5 text-ink-soft" />
              <input
                type="color"
                className="sr-only"
                aria-label="Custom color"
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
        </Popout>
      )}

      {popover === 'labels' && (
        <Popout>
          <input
            value={labelDraft}
            autoFocus
            placeholder="Add a label…"
            aria-label="Add a label"
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') addLabel(labelDraft);
            }}
            className="mb-2 w-full rounded-md border border-card-border bg-panel px-2 py-1 text-sm outline-none"
          />
          {single && (single.style.labels?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {single.style.labels!.map((l) => (
                <button
                  key={l}
                  onClick={() => removeLabel(l)}
                  className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent hover:opacity-80"
                  title="Remove label"
                >
                  {l} <span className="text-[10px]">✕</span>
                </button>
              ))}
            </div>
          )}
        </Popout>
      )}

      {popover === 'reactions' && (
        <Popout>
          <div className="flex flex-wrap gap-1">
            {REACTION_EMOJI.map((emoji) => (
              <button
                key={emoji}
                aria-label={`React ${emoji}`}
                onClick={() => addReaction(emoji)}
                className="rounded-md px-1.5 py-1 text-lg hover:bg-panel-border/60"
              >
                {emoji}
              </button>
            ))}
          </div>
        </Popout>
      )}

      {popover === 'caption' && single && (
        <Popout>
          <input
            key={single.id}
            defaultValue={captionValue(single)}
            autoFocus
            placeholder="Add a caption…"
            aria-label="Caption"
            onChange={(e) => setCaption(single, e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') setPopover(null);
            }}
            className="w-56 rounded-md border border-card-border bg-panel px-2 py-1 text-sm outline-none"
          />
        </Popout>
      )}

      {popover === 'more' && (
        <Popout align="right">
          <MenuItem icon={Scissors} label="Cut" onClick={() => copy(true)} />
          <MenuItem icon={Copy} label="Copy" onClick={() => copy(false)} />
          <MenuItem icon={CopyPlus} label="Paste" onClick={paste} disabled={!useUiStore.getState().clipboard?.length} />
          <MenuItem icon={CopyPlus} label="Duplicate" onClick={duplicate} />
          <MenuItem icon={Columns2} label="Group into Column" onClick={group} />
          <div className="my-1 h-px bg-card-border" />
          <MenuItem icon={anyLocked ? Unlock : Lock} label={anyLocked ? 'Unlock' : 'Lock Position'} onClick={toggleLock} />
          <MenuItem icon={ArrowUpToLine} label="Bring to front" onClick={() => zOrder('front')} />
          <MenuItem icon={ArrowDownToLine} label="Send to back" onClick={() => zOrder('back')} />
          <div className="my-1 h-px bg-card-border" />
          <MenuItem icon={Trash2} label="Move to trash" danger onClick={trash} />
        </Popout>
      )}
    </div>
  );
}

function Popout({
  children,
  align = 'center',
}: {
  children: React.ReactNode;
  align?: 'center' | 'right';
}) {
  return (
    <div
      className={`absolute top-full mt-1.5 rounded-lg border border-card-border bg-card p-2 shadow-card-drag ${
        align === 'right' ? 'right-0 w-52' : 'left-1/2 -translate-x-1/2'
      }`}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-40 ${
        danger ? 'text-red-600 hover:bg-red-500/10' : 'text-ink hover:bg-panel-border/50'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" /> {label}
    </button>
  );
}
