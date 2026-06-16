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
  | 'comment'
  | 'document';

export interface Board {
  id: string;
  title: string;
  parentBoardId: string | null;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
  /** deviceId of the last writer — deterministic tie-break for sync LWW. */
  modifiedBy?: string;
}

/** TipTap document JSON — opaque to the data layer. */
export interface TipTapDoc {
  type: 'doc';
  content?: unknown[];
}

export interface NoteContent {
  doc: TipTapDoc;
}
/**
 * Document = a long-form note with its own title and an expanded editor view.
 * Shares TipTap doc storage with notes so the rich-text pipeline is reused.
 */
export interface DocumentContent {
  doc: TipTapDoc;
  title: string;
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
  /** Whole-list due date (ms epoch). */
  dueDate?: number;
  /** Assignee — a free-text name (or user id when auth exists). */
  assigneeId?: string;
}
export interface ColumnContent {
  title: string;
  collapsed: boolean;
}
/** How a swatch renders its colour value caption. */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'off';
export interface SwatchContent {
  hex: string;
  label?: string;
  /** Longer descriptive caption shown under the colour. */
  caption?: string;
  /** Value display format (default 'hex'). */
  format?: ColorFormat;
}
export type LineEndpoint =
  | { elementId: string; side?: 'n' | 'e' | 's' | 'w' }
  | { point: { x: number; y: number } };
/** Endpoint cap styles for connector lines. */
export type LineMarker = 'none' | 'arrow' | 'circle' | 'square';
export interface LineContent {
  from: LineEndpoint;
  to: LineEndpoint;
  curve: boolean;
  dashed: boolean;
  /** Legacy end-arrow toggle. `endMarker` overrides it when set. */
  arrowEnd: boolean;
  /** Stroke colour (default theme grey when unset). */
  color?: string;
  startMarker?: LineMarker;
  endMarker?: LineMarker;
  /** Optional label rendered at the line midpoint. */
  label?: string;
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
/** A single reply under a comment thread. */
export interface CommentReply {
  id: string;
  authorName: string;
  doc: TipTapDoc;
  createdAt: number;
}
export interface CommentContent {
  doc: TipTapDoc;
  authorName: string;
  resolved: boolean;
  /** When the root comment was written (ms epoch). */
  createdAt?: number;
  /** Threaded replies, oldest first. */
  replies?: CommentReply[];
}

export type ElementContent =
  | NoteContent
  | DocumentContent
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
  /** Card background tint (hex). */
  color?: string;
  /** When true the element can't be moved, resized or edited. */
  locked?: boolean;
  /** Free-text labels/tags shown on the card. */
  labels?: string[];
  /** Emoji reaction counts, keyed by emoji. */
  reactions?: Record<string, number>;
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
  /** deviceId of the last writer — deterministic tie-break for sync LWW. */
  modifiedBy?: string;
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
  /** Board the entity belonged to (elements; null/undefined for boards). */
  boardId?: string | null;
  /** deviceId that performed the deletion (sync tie-break). */
  deletedBy?: string;
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
