/**
 * Core entity types. Every row carries `updatedAt` (ms epoch) and every write
 * bumps it; deletions write a tombstone. This discipline exists from M0 so
 * Drive sync (M6) is a pure layer on top, not a retrofit.
 */

export type ElementType =
  | 'note'
  | 'title'
  | 'image'
  | 'link'
  | 'todo'
  | 'column'
  | 'swatch'
  | 'line'
  | 'drawing'
  | 'boardLink'
  | 'comment';

export interface Board {
  id: string;
  title: string;
  parentBoardId: string | null;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
}

/** TipTap document JSON — opaque to the data layer. */
export interface TipTapDoc {
  type: 'doc';
  content?: unknown[];
}

export interface NoteContent {
  doc: TipTapDoc;
}
export interface TitleContent {
  text: string;
}
export interface ImageContent {
  assetId: string;
  naturalW: number;
  naturalH: number;
  caption?: string;
}
export interface LinkContent {
  url: string;
  title?: string;
  description?: string;
  faviconAssetId?: string;
  previewAssetId?: string;
}
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}
export interface TodoContent {
  title?: string;
  items: TodoItem[];
}
export interface ColumnContent {
  title: string;
  collapsed: boolean;
}
export interface SwatchContent {
  hex: string;
  label?: string;
}
export type LineEndpoint =
  | { elementId: string; side?: 'n' | 'e' | 's' | 'w' }
  | { point: { x: number; y: number } };
export interface LineContent {
  from: LineEndpoint;
  to: LineEndpoint;
  curve: boolean;
  dashed: boolean;
  arrowEnd: boolean;
}
export interface DrawingPath {
  points: number[]; // flat [x0, y0, x1, y1, ...] in element-local coords
  color: string;
  width: number;
}
export interface DrawingContent {
  paths: DrawingPath[];
}
export interface BoardLinkContent {
  boardId: string;
}
export interface CommentContent {
  doc: TipTapDoc;
  authorName: string;
  resolved: boolean;
}

export type ElementContent =
  | NoteContent
  | TitleContent
  | ImageContent
  | LinkContent
  | TodoContent
  | ColumnContent
  | SwatchContent
  | LineContent
  | DrawingContent
  | BoardLinkContent
  | CommentContent;

export interface ElementStyle {
  color?: string;
}

export interface Element {
  id: string;
  boardId: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  /** When set, this element is stacked inside a column. */
  parentColumnId: string | null;
  /** Order within the parent column. */
  sortIndex: number;
  content: ElementContent;
  style: ElementStyle;
  createdAt: number;
  updatedAt: number;
}

export interface Asset {
  id: string;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  driveFileId?: string;
  uploadedAt?: number;
}

export type EntityType = 'board' | 'element' | 'asset';

export interface Tombstone {
  id: string; // id of the deleted entity
  entityType: EntityType;
  deletedAt: number;
}

export interface OutboxEntry {
  /** auto-increment primary key */
  seq?: number;
  entityType: EntityType;
  entityId: string;
  /** board the entity belongs to — sync pushes per board file */
  boardId: string | null;
  queuedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}
