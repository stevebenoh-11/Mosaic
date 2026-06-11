import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, LayoutGrid, Search, StickyNote } from 'lucide-react';
import { db, getMeta } from '@/db/schema';
import { useStore } from '@/store';
import { useUiStore } from './uiStore';
import { elementText, fuzzyScore } from './searchText';
import type { Element } from '@/db/types';

interface Result {
  kind: 'board' | 'element';
  id: string;
  boardId: string;
  title: string;
  context: string;
  score: number;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setFlashElementId = useUiStore((s) => s.setFlashElementId);
  const boards = useStore((s) => s.boards);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [allElements, setAllElements] = useState<Element[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the index when the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    void db.elements.toArray().then(setAllElements);
    void getMeta<string[]>('recentBoards').then((r) => setRecents(r ?? []));
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const results = useMemo((): Result[] => {
    if (!query.trim()) {
      return recents
        .filter((id) => boards[id])
        .map((id) => ({
          kind: 'board' as const,
          id,
          boardId: id,
          title: boards[id]!.title || 'Untitled board',
          context: 'Recent board',
          score: 0,
        }));
    }
    const out: Result[] = [];
    for (const b of Object.values(boards)) {
      const score = fuzzyScore(query, b.title);
      if (score >= 0) {
        out.push({
          kind: 'board',
          id: b.id,
          boardId: b.id,
          title: b.title || 'Untitled board',
          context: 'Board',
          score: score + 40, // boards rank slightly above elements
        });
      }
    }
    for (const el of allElements) {
      const text = elementText(el);
      if (!text) continue;
      const score = fuzzyScore(query, text);
      if (score >= 0) {
        out.push({
          kind: 'element',
          id: el.id,
          boardId: el.boardId,
          title: text.length > 70 ? `${text.slice(0, 70)}…` : text,
          context: `${el.type} · ${boards[el.boardId]?.title ?? 'board'}`,
          score,
        });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 20);
  }, [query, boards, allElements, recents]);

  function pick(r: Result) {
    setOpen(false);
    navigate(`/b/${r.boardId}`);
    if (r.kind === 'element') {
      setFlashElementId(r.id);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-card-border bg-card shadow-card-drag"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search"
      >
        <div className="flex items-center gap-2 border-b border-card-border px-3">
          <Search className="h-4 w-4 text-ink-soft" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const r = results[active];
                if (r) pick(r);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Search boards and cards…"
            aria-label="Search boards and cards"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-soft/60"
          />
          <kbd className="rounded border border-card-border bg-panel px-1.5 py-0.5 text-[10px] text-ink-soft">
            esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-ink-soft">
              {query ? 'No matches.' : 'No recent boards yet.'}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}:${r.id}`}
              data-testid="palette-result"
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                i === active ? 'bg-accent-soft/60' : ''
              }`}
            >
              {r.kind === 'board' ? (
                r.context === 'Recent board' ? (
                  <Clock className="h-4 w-4 shrink-0 text-ink-soft" />
                ) : (
                  <LayoutGrid className="h-4 w-4 shrink-0 text-accent" />
                )
              ) : (
                <StickyNote className="h-4 w-4 shrink-0 text-ink-soft" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block truncate text-xs text-ink-soft">
                  {r.context}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
