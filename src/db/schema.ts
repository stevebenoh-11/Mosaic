import Dexie, { type EntityTable } from 'dexie';
import type {
  Asset,
  Board,
  Element,
  MetaRow,
  OutboxEntry,
  Tombstone,
} from './types';

export class MosaicDB extends Dexie {
  boards!: EntityTable<Board, 'id'>;
  elements!: EntityTable<Element, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  tombstones!: EntityTable<Tombstone, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'mosaic') {
    super(name);
    this.version(1).stores({
      boards: 'id, parentBoardId, updatedAt',
      elements: 'id, boardId, parentColumnId, updatedAt, [boardId+updatedAt]',
      assets: 'id, driveFileId',
      tombstones: 'id, entityType, deletedAt',
      outbox: '++seq, entityId, boardId, [entityType+entityId]',
      meta: 'key',
    });
  }
}

export const db = new MosaicDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
