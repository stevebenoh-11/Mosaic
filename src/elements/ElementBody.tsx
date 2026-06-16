import type { Element } from '@/db/types';
import { COLUMNABLE_TYPES } from '@/store/elementCommands';
import { NoteCard } from './note/NoteCard';
import { DocumentCard } from './document/DocumentCard';
import { TitleCard } from './title/TitleCard';
import { SwatchCard } from './swatch/SwatchCard';
import { ImageCard } from './image/ImageCard';
import { LinkCard } from './link/LinkCard';
import { TodoCard } from './todo/TodoCard';
import { ColumnCard } from './column/ColumnCard';
import { BoardLinkCard } from './boardLink/BoardLinkCard';
import { DrawingCard } from './drawing/DrawingCard';

/** Per-type card body, shared by canvas cards and column children. */
export function ElementBody({
  element,
  editing,
}: {
  element: Element;
  editing: boolean;
}) {
  switch (element.type) {
    case 'note':
      return <NoteCard element={element} editing={editing} />;
    case 'document':
      return <DocumentCard element={element} editing={editing} />;
    case 'title':
      return <TitleCard element={element} editing={editing} />;
    case 'swatch':
      return <SwatchCard element={element} editing={editing} />;
    case 'image':
      return <ImageCard element={element} />;
    case 'link':
      return <LinkCard element={element} />;
    case 'todo':
      return <TodoCard element={element} />;
    case 'column':
      return <ColumnCard element={element} />;
    case 'boardLink':
      return <BoardLinkCard element={element} />;
    case 'drawing':
      return <DrawingCard element={element} />;
    default:
      return (
        <div className="p-3 text-xs text-ink-soft">{element.type}</div>
      );
  }
}

/** Types that may live inside a column. */
export const COLUMNABLE = COLUMNABLE_TYPES;
