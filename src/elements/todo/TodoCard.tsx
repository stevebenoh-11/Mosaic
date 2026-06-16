import { memo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GripVertical, Plus, User, X } from 'lucide-react';
import { useStore } from '@/store';
import { newId } from '@/db/ids';
import type { Element, TodoContent, TodoItem } from '@/db/types';

function toDateInput(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function commitItems(element: Element, items: TodoItem[], label: string, coalesceKey?: string) {
  const state = useStore.getState();
  const before = state.elements[element.id];
  if (!before) return;
  const content = before.content as TodoContent;
  const after: Element = { ...before, content: { ...content, items } };
  state.execute({
    label,
    ...(coalesceKey ? { coalesceKey } : {}),
    changes: [{ entity: 'element', id: element.id, before, after }],
  });
}

function TodoRow({
  element,
  item,
}: {
  element: Element;
  item: TodoItem;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const items = (element.content as TodoContent).items;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-start gap-1.5 rounded px-1 py-0.5 ${isDragging ? 'z-10 bg-panel shadow-card' : ''}`}
    >
      <button
        aria-label="Reorder item"
        {...attributes}
        {...listeners}
        onPointerDownCapture={(e) => e.stopPropagation()}
        className="mt-0.5 cursor-grab touch-none text-ink-soft/40 opacity-0 group-hover:opacity-100"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <input
        type="checkbox"
        checked={item.done}
        aria-label={`Toggle ${item.text || 'item'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={() =>
          commitItems(
            element,
            items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
            'Toggle to-do',
          )
        }
        className="mt-1 accent-accent"
      />
      <input
        value={item.text}
        aria-label="To-do text"
        placeholder="To-do"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) =>
          commitItems(
            element,
            items.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)),
            'Edit to-do',
            `todo:${element.id}:${item.id}`,
          )
        }
        onBlur={() => useStore.getState().breakCoalescing()}
        className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${item.done ? 'text-ink-soft line-through' : ''}`}
      />
      <button
        aria-label="Remove item"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() =>
          commitItems(element, items.filter((i) => i.id !== item.id), 'Remove to-do')
        }
        className="mt-0.5 text-ink-soft/40 opacity-0 hover:text-ink group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export const TodoCard = memo(function TodoCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as TodoContent;
  const [draft, setDraft] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function addItem() {
    const text = draft.trim();
    if (!text) return;
    commitItems(
      element,
      [...c.items, { id: newId(), text, done: false }],
      'Add to-do',
    );
    setDraft('');
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = c.items.findIndex((i) => i.id === active.id);
    const to = c.items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    commitItems(element, arrayMove(c.items, from, to), 'Reorder to-dos');
  }

  function setTitle(title: string) {
    commitMeta({ title }, 'Edit to-do title', `todotitle:${element.id}`);
  }

  function commitMeta(patch: Partial<TodoContent>, label: string, coalesceKey?: string) {
    const state = useStore.getState();
    const before = state.elements[element.id];
    if (!before) return;
    const after: Element = {
      ...before,
      content: { ...(before.content as TodoContent), ...patch },
    };
    state.execute({
      label,
      ...(coalesceKey ? { coalesceKey } : {}),
      changes: [{ entity: 'element', id: element.id, before, after }],
    });
  }

  return (
    <div className="flex h-full flex-col p-2.5">
      <input
        value={c.title ?? ''}
        placeholder="To-do list"
        aria-label="To-do list title"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => useStore.getState().breakCoalescing()}
        className="mb-1 bg-transparent text-sm font-semibold outline-none placeholder:text-ink-soft/50"
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={c.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {c.items.map((item) => (
            <TodoRow key={item.id} element={element} item={item} />
          ))}
        </SortableContext>
      </DndContext>
      <div className="mt-1 flex items-center gap-1.5 pl-6">
        <Plus className="h-3.5 w-3.5 text-ink-soft/50" />
        <input
          value={draft}
          placeholder="Add a task…"
          aria-label="Add a task"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') addItem();
          }}
          onBlur={addItem}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-soft/50"
        />
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-card-border/60 pt-1.5 text-xs text-ink-soft">
        <label className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <input
            type="date"
            value={toDateInput(c.dueDate)}
            aria-label="Due date"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              commitMeta(
                { dueDate: e.target.value ? new Date(`${e.target.value}T00:00:00`).getTime() : undefined },
                'Set due date',
              )
            }
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 shrink-0" />
          <input
            value={c.assigneeId ?? ''}
            placeholder="Assign to…"
            aria-label="Assignee"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => commitMeta({ assigneeId: e.target.value || undefined }, 'Set assignee', `assignee:${element.id}`)}
            onBlur={() => useStore.getState().breakCoalescing()}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-soft/50"
          />
        </label>
      </div>
    </div>
  );
});
