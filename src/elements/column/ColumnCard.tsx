import { memo, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '@/store';
import { useUiStore } from '@/ui/uiStore';
import type { ColumnContent, Element } from '@/db/types';
import { ElementBody } from '../ElementBody';

export function columnChildren(
  elements: Record<string, Element>,
  columnId: string,
): Element[] {
  return Object.values(elements)
    .filter((e) => e.parentColumnId === columnId)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt);
}

function ColumnChild({ child }: { child: Element }) {
  const editing = useStore((s) => s.editingElementId === child.id);
  const setEditing = useStore((s) => s.setEditing);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: child.id,
    data: { columnId: child.parentColumnId },
    disabled: editing,
  });

  return (
    <div
      ref={setNodeRef}
      data-child-id={child.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        // Keep canvas drag/marquee machinery out; dnd-kit's own listener
        // (same node) still fires.
        e.stopPropagation();
        listeners?.onPointerDown?.(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (child.type === 'note' || child.type === 'title' || child.type === 'swatch') {
          setEditing(child.id);
        }
      }}
      className="touch-none rounded-md border border-card-border bg-card shadow-card"
    >
      <ElementBody element={child} editing={editing} />
    </div>
  );
}

export const ColumnCard = memo(function ColumnCard({
  element,
}: {
  element: Element;
}) {
  const c = element.content as ColumnContent;
  const elements = useStore((s) => s.elements);
  const editing = useStore((s) => s.editingElementId === element.id);
  const dropTarget = useUiStore((s) => s.columnDropTarget);

  const children = useMemo(
    () => columnChildren(elements, element.id),
    [elements, element.id],
  );

  const { setNodeRef } = useDroppable({
    id: `column:${element.id}`,
    data: { columnId: element.id },
  });

  function commit(patch: Partial<ColumnContent>, label: string, coalesce = false) {
    const state = useStore.getState();
    const before = state.elements[element.id];
    if (!before) return;
    const after: Element = {
      ...before,
      content: { ...(before.content as ColumnContent), ...patch },
    };
    state.execute({
      label,
      ...(coalesce ? { coalesceKey: `column:${element.id}` } : {}),
      changes: [{ entity: 'element', id: element.id, before, after }],
    });
  }

  const indicatorIndex =
    dropTarget && dropTarget.columnId === element.id ? dropTarget.index : null;

  return (
    <div
      ref={setNodeRef}
      data-column-id={element.id}
      className="flex h-full flex-col rounded-md bg-panel-border/40 p-2"
    >
      <div className="mb-1 flex items-center gap-1 px-1">
        <button
          aria-label={c.collapsed ? 'Expand column' : 'Collapse column'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => commit({ collapsed: !c.collapsed }, 'Toggle column')}
          className="text-ink-soft hover:text-ink"
        >
          {c.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {editing ? (
          <input
            value={c.title}
            autoFocus
            aria-label="Column title"
            onFocus={(e) => e.target.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => commit({ title: e.target.value }, 'Rename column', true)}
            onBlur={() => useStore.getState().setEditing(null)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') {
                useStore.getState().setEditing(null);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {c.title || 'Column'}
          </span>
        )}
        <span className="rounded-full bg-panel-border px-1.5 text-[11px] text-ink-soft">
          {children.length}
        </span>
      </div>

      {!c.collapsed && (
        <SortableContext
          items={children.map((ch) => ch.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex min-h-10 flex-col gap-2">
            {children.length === 0 && indicatorIndex === null && (
              <div className="rounded border border-dashed border-card-border px-2 py-3 text-center text-xs text-ink-soft/70">
                Drag cards here
              </div>
            )}
            {children.map((child, i) => (
              <div key={child.id} className="relative">
                {indicatorIndex === i && <DropLine />}
                <ColumnChild child={child} />
              </div>
            ))}
            {indicatorIndex !== null && indicatorIndex >= children.length && (
              <DropLine static />
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
});

function DropLine({ static: isStatic }: { static?: boolean }) {
  return (
    <div
      className={`${isStatic ? '' : 'absolute -top-1.5 left-0 right-0 '}h-0.5 rounded bg-accent`}
    />
  );
}
