import { X } from 'lucide-react';
import { useUiStore } from './uiStore';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Canvas',
    rows: [
      ['Space + drag / middle mouse', 'Pan'],
      ['Ctrl + scroll / pinch', 'Zoom'],
      ['Double-click empty canvas', 'New note'],
      ['Drag from toolbar', 'Add element'],
    ],
  },
  {
    title: 'Selection',
    rows: [
      ['Click / Shift + click', 'Select / add to selection'],
      ['Drag on empty canvas', 'Marquee select'],
      ['Enter', 'Edit selected card'],
      ['Esc', 'Exit edit / clear selection'],
      ['Delete / Backspace', 'Delete selection'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
      ['Ctrl + D', 'Duplicate'],
      ['Alt + drag', 'Duplicate by dragging'],
      ['] / [', 'Bring forward / send backward'],
      ['Shift + ] / Shift + [', 'Bring to front / send to back'],
      ['?', 'Toggle this panel'],
    ],
  },
];

export function ShortcutsPanel() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-card-border bg-card p-5 shadow-card-drag"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-4">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              {g.title}
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {g.rows.map(([keys, action]) => (
                  <tr key={keys}>
                    <td className="py-1 pr-3">
                      <kbd className="rounded border border-card-border bg-panel px-1.5 py-0.5 text-[11px] text-ink-soft">
                        {keys}
                      </kbd>
                    </td>
                    <td className="py-1 text-ink">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
