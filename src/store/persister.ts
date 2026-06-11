import { db } from '@/db/schema';
import type { Board, Element, EntityType } from '@/db/types';

type EntityKind = 'board' | 'element';

interface DirtyEntry {
  entity: EntityKind;
  id: string;
  /** Board the entity belongs to (null for boards themselves). */
  boardId: string | null;
}

/** Fired (on window) after a flush adds outbox rows — the sync engine listens. */
export const OUTBOX_EVENT = 'mosaic:outbox';

/**
 * Debounced write-behind from the in-memory store to Dexie.
 * The store is the live truth; this catches Dexie (and the sync outbox) up.
 * Deletions write tombstones; re-creations (undo of delete) clear them.
 */
export class Persister {
  private dirty = new Map<string, DirtyEntry>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly getEntity: (
      entity: EntityKind,
      id: string,
    ) => Board | Element | undefined,
    private readonly onStateChange: (state: 'saving' | 'saved') => void,
    private readonly debounceMs = 300,
  ) {}

  markDirty(entity: EntityKind, id: string, boardId: string | null): void {
    this.dirty.set(`${entity}:${id}`, { entity, id, boardId });
    this.onStateChange('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Flush now (also chained behind any in-flight flush). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) await this.flushing;
    if (this.dirty.size === 0) {
      this.onStateChange('saved');
      return;
    }
    const batch = [...this.dirty.values()];
    this.dirty.clear();

    this.flushing = this.writeBatch(batch).finally(() => {
      this.flushing = null;
    });
    await this.flushing;
    if (this.dirty.size === 0) this.onStateChange('saved');
  }

  private async writeBatch(batch: DirtyEntry[]): Promise<void> {
    const now = Date.now();
    const deviceId = (await db.meta.get('deviceId'))?.value as string | undefined;
    await db.transaction(
      'rw',
      [db.boards, db.elements, db.tombstones, db.outbox],
      async () => {
        for (const { entity, id, boardId } of batch) {
          const entityType: EntityType = entity;
          const current = this.getEntity(entity, id);

          if (current) {
            const stamped = { ...current, modifiedBy: deviceId };
            if (entity === 'board') await db.boards.put(stamped as Board);
            else await db.elements.put(stamped as Element);
            await db.tombstones.delete(id);
          } else {
            if (entity === 'board') await db.boards.delete(id);
            else await db.elements.delete(id);
            await db.tombstones.put({
              id,
              entityType,
              deletedAt: now,
              boardId,
              deletedBy: deviceId,
            });
          }

          // Outbox: one pending entry per entity (latest wins).
          await db.outbox
            .where('[entityType+entityId]')
            .equals([entityType, id])
            .delete();
          await db.outbox.add({ entityType, entityId: id, boardId, queuedAt: now });
        }
      },
    );
    window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
  }
}
