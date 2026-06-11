/**
 * Push/pull/merge sync engine. Pure layer over Dexie: it never touches the
 * zustand store or history — it reads/writes rows, clears the outbox after
 * confirmed uploads, and reports applied changes via callbacks.
 */
import type { MosaicDB } from '@/db/schema';
import type { Board, Element, Tombstone } from '@/db/types';
import { mergeSets, type TombRecord } from './merge';
import type {
  BoardFile,
  Manifest,
  ManifestBoardEntry,
  RemoteStore,
  SyncLogEntry,
  SyncStatus,
} from './types';

const SCHEMA_VERSION = 1;
const MAX_LOG = 100;

export interface EngineCallbacks {
  onStatus?(status: SyncStatus, detail?: string): void;
  /** Remote changes were written into Dexie for these boards. */
  onRemoteApplied?(boardIds: string[]): void;
  onLog?(entries: SyncLogEntry[]): void;
}

export class SyncEngine {
  private running = false;
  private rerun = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private assetAttempts = new Map<string, number>();
  private assetRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: MosaicDB,
    private readonly remote: RemoteStore,
    _deviceId: string, // rows are stamped at write time; kept for future use
    private readonly callbacks: EngineCallbacks = {},
  ) {}

  // ---------- meta helpers ----------

  private async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }
  private async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  private async appendLog(entries: SyncLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const log = (await this.getMeta<SyncLogEntry[]>('sync:log')) ?? [];
    const next = [...entries, ...log].slice(0, MAX_LOG);
    await this.setMeta('sync:log', next);
    this.callbacks.onLog?.(next);
  }

  // ---------- scheduling ----------

  schedulePush(debounceMs = 4000): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.syncNow('push');
    }, debounceMs);
  }

  async syncNow(_reason = 'manual'): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.callbacks.onStatus?.('syncing');
    try {
      await this.remote.init();
      const applied = new Set<string>();
      await this.pull(applied);
      await this.push(applied);
      await this.pushAssets();
      if (applied.size > 0) this.callbacks.onRemoteApplied?.([...applied]);
      await this.setMeta('sync:lastSyncedAt', Date.now());
      this.callbacks.onStatus?.('synced');
    } catch (err) {
      this.reportError(err);
      throw err;
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        setTimeout(() => void this.syncNow('rerun'), 50);
      }
    }
  }

  private reportError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const isAuth =
      (err as { code?: string }).code !== undefined ||
      /401|consent|token/i.test(message);
    const isNetwork =
      err instanceof TypeError || /Failed to fetch|NetworkError/i.test(message);
    if (isNetwork) this.callbacks.onStatus?.('offline', message);
    else if (isAuth) this.callbacks.onStatus?.('paused', message);
    else this.callbacks.onStatus?.('paused', message);
  }

  // ---------- pull ----------

  /** Per-cycle cache of remote board-file tombstones (for push composition). */
  private cycleFileTombs = new Map<string, TombRecord[]>();

  private async pull(applied: Set<string>): Promise<void> {
    this.cycleFileTombs.clear();

    // 1. Manifest → board rows.
    const remoteManifest = await this.remote.getManifest();
    if (remoteManifest) {
      const localBoards = await this.db.boards.toArray();
      const localTombs = (await this.db.tombstones.toArray()).filter(
        (t) => t.entityType === 'board',
      );
      const remoteRows: Board[] = [];
      const remoteTombs: TombRecord[] = [];
      for (const entry of remoteManifest.data.boards ?? []) {
        if (entry.deleted) {
          remoteTombs.push({
            id: entry.id,
            deletedAt: entry.deletedAt ?? entry.updatedAt,
            deletedBy: entry.modifiedBy ?? '',
          });
        } else {
          const local = localBoards.find((b) => b.id === entry.id);
          const boardRow: Board = {
            id: entry.id,
            title: entry.title,
            parentBoardId: entry.parentBoardId,
            sortIndex: entry.sortIndex,
            createdAt: local?.createdAt ?? entry.updatedAt,
            updatedAt: entry.updatedAt,
          };
          if (entry.modifiedBy !== undefined) boardRow.modifiedBy = entry.modifiedBy;
          remoteRows.push(boardRow);
        }
      }
      const result = mergeSets(
        localBoards,
        localTombs.map((t) => ({
          id: t.id,
          deletedAt: t.deletedAt,
          deletedBy: t.deletedBy ?? '',
        })),
        remoteRows,
        remoteTombs,
      );
      for (const row of result.applyLocally.rows) {
        await this.db.boards.put(row);
        await this.db.tombstones.delete(row.id);
        applied.add(row.id);
      }
      for (const del of result.applyLocally.deletions) {
        const had = await this.db.boards.get(del.id);
        if (had) {
          await this.db.boards.delete(del.id);
          await this.db.elements.where('boardId').equals(del.id).delete();
          applied.add(del.id);
        }
        const tomb: Tombstone = {
          id: del.id,
          entityType: 'board',
          deletedAt: del.deletedAt,
        };
        if (del.deletedBy) tomb.deletedBy = del.deletedBy;
        await this.db.tombstones.put(tomb);
      }
      await this.appendLog(
        result.conflicts.map((c) => ({
          at: Date.now(),
          boardId: null,
          entityId: c.id,
          resolution: `board: ${c.resolution}`,
        })),
      );
    }

    // 2. Board files with changed revisions.
    const files = await this.remote.listBoardFiles();
    for (const file of files) {
      if (!file.name.endsWith('.json')) continue;
      const boardId = file.name.slice(0, -'.json'.length);
      const known = await this.getMeta<string>(`sync:boardrev:${boardId}`);
      if (known === file.headRevisionId) continue;
      const remoteFile = await this.remote.getBoardFile(boardId);
      if (!remoteFile) continue;
      const changedLocally = await this.mergeBoardFile(boardId, remoteFile.data, applied);
      await this.setMeta(`sync:boardrev:${boardId}`, remoteFile.meta.headRevisionId);
      if (changedLocally.remoteNeedsUpdate) {
        // Local has newer content — make sure push picks this board up.
        await this.db.outbox.add({
          entityType: 'element',
          entityId: `merge:${boardId}`,
          boardId,
          queuedAt: Date.now(),
        });
      }
    }
  }

  private async mergeBoardFile(
    boardId: string,
    file: BoardFile,
    applied: Set<string>,
  ): Promise<{ remoteNeedsUpdate: boolean }> {
    const remoteRows = file.elements ?? [];
    const remoteTombs: TombRecord[] = (file.tombstones ?? []).map((t) => ({
      id: t.id,
      deletedAt: t.deletedAt,
      deletedBy: t.deletedBy ?? '',
    }));

    const localInBoard = await this.db.elements.where('boardId').equals(boardId).toArray();
    // Rows that moved to another board locally must still beat stale remote
    // copies — include any local row matching a remote id.
    const remoteIds = remoteRows.map((r) => r.id);
    const globalMatches = (await this.db.elements.bulkGet(remoteIds)).filter(
      (e): e is Element => !!e,
    );
    const localRows = [...new Map([...localInBoard, ...globalMatches].map((e) => [e.id, e])).values()];

    const allTombs = await this.db.tombstones.toArray();
    const localTombs = allTombs
      .filter(
        (t) =>
          t.entityType === 'element' &&
          (t.boardId === boardId || remoteIds.includes(t.id)),
      )
      .map((t) => ({ id: t.id, deletedAt: t.deletedAt, deletedBy: t.deletedBy ?? '' }));

    const result = mergeSets(localRows, localTombs, remoteRows, remoteTombs);

    for (const row of result.applyLocally.rows) {
      await this.db.elements.put(row);
      await this.db.tombstones.delete(row.id);
      applied.add(row.boardId);
    }
    for (const del of result.applyLocally.deletions) {
      const had = await this.db.elements.get(del.id);
      if (had) {
        await this.db.elements.delete(del.id);
        applied.add(had.boardId);
      }
      const tomb: Tombstone = {
        id: del.id,
        entityType: 'element',
        deletedAt: del.deletedAt,
        boardId,
      };
      if (del.deletedBy) tomb.deletedBy = del.deletedBy;
      await this.db.tombstones.put(tomb);
    }

    this.cycleFileTombs.set(boardId, result.tombs);
    await this.appendLog(
      result.conflicts.map((c) => ({
        at: Date.now(),
        boardId,
        entityId: c.id,
        resolution: c.resolution,
      })),
    );
    return { remoteNeedsUpdate: result.remoteChanged };
  }

  // ---------- push ----------

  private async push(applied: Set<string>): Promise<void> {
    const entries = await this.db.outbox.toArray();
    const nonAsset = entries.filter((e) => e.entityType !== 'asset');
    if (nonAsset.length === 0) return;
    const maxSeq = Math.max(...nonAsset.map((e) => e.seq ?? 0));

    const dirtyBoardIds = new Set<string>();
    let manifestDirty = false;
    for (const entry of nonAsset) {
      if (entry.entityType === 'board') manifestDirty = true;
      else if (entry.boardId) dirtyBoardIds.add(entry.boardId);
    }

    for (const boardId of dirtyBoardIds) {
      const board = await this.db.boards.get(boardId);
      if (!board) {
        // Board deleted — manifest carries the tombstone; skip the file.
        manifestDirty = true;
        continue;
      }
      // Read-merge-write: if the remote revision moved since we last saw it,
      // merge first so we never clobber a concurrent writer.
      const known = await this.getMeta<string>(`sync:boardrev:${boardId}`);
      const current = await this.remote.getBoardFile(boardId);
      if (current && current.meta.headRevisionId !== known) {
        await this.mergeBoardFile(boardId, current.data, applied);
      }

      const elements = await this.db.elements.where('boardId').equals(boardId).toArray();
      const localTombs = (await this.db.tombstones.toArray())
        .filter((t) => t.entityType === 'element' && t.boardId === boardId)
        .map((t) => {
          const rec: TombRecord = { id: t.id, deletedAt: t.deletedAt };
          if (t.deletedBy) rec.deletedBy = t.deletedBy;
          return rec;
        });
      const fileTombs = this.cycleFileTombs.get(boardId) ?? [];
      const tombs = [...new Map(
        [...fileTombs, ...localTombs].map((t) => [t.id, t]),
      ).values()].filter((t) => !elements.some((e) => e.id === t.id));

      const data: BoardFile = {
        schemaVersion: SCHEMA_VERSION,
        board,
        elements,
        tombstones: tombs,
      };
      const meta = await this.remote.putBoardFile(boardId, data);
      await this.setMeta(`sync:boardrev:${boardId}`, meta.headRevisionId);
      manifestDirty = true;
    }

    if (manifestDirty) {
      const boards = await this.db.boards.toArray();
      const boardTombs = (await this.db.tombstones.toArray()).filter(
        (t) => t.entityType === 'board',
      );
      const manifest: Manifest = {
        schemaVersion: SCHEMA_VERSION,
        lastCompactedAt: 0,
        boards: [
          ...boards.map((b): ManifestBoardEntry => {
            const entry: ManifestBoardEntry = {
              id: b.id,
              title: b.title,
              parentBoardId: b.parentBoardId,
              sortIndex: b.sortIndex,
              updatedAt: b.updatedAt,
            };
            if (b.modifiedBy !== undefined) entry.modifiedBy = b.modifiedBy;
            return entry;
          }),
          ...boardTombs.map((t): ManifestBoardEntry => {
            const entry: ManifestBoardEntry = {
              id: t.id,
              title: '',
              parentBoardId: null,
              sortIndex: 0,
              updatedAt: t.deletedAt,
              deleted: true,
              deletedAt: t.deletedAt,
            };
            if (t.deletedBy !== undefined) entry.modifiedBy = t.deletedBy;
            return entry;
          }),
        ],
      };
      await this.remote.putManifest(manifest);
    }

    // Confirmed upload: clear the outbox rows that existed when we started.
    await this.db.outbox
      .where('seq')
      .belowOrEqual(maxSeq)
      .filter((e) => e.entityType !== 'asset')
      .delete();
  }

  // ---------- assets ----------

  private async pushAssets(): Promise<void> {
    const entries = (await this.db.outbox.toArray()).filter(
      (e) => e.entityType === 'asset',
    );
    let failed = false;
    for (const entry of entries) {
      const asset = await this.db.assets.get(entry.entityId);
      if (!asset) {
        if (entry.seq !== undefined) await this.db.outbox.delete(entry.seq);
        continue;
      }
      try {
        const meta = await this.remote.uploadAsset(asset.id, asset.blob, asset.name);
        await this.db.assets.update(asset.id, {
          driveFileId: meta.id,
          uploadedAt: Date.now(),
        });
        if (entry.seq !== undefined) await this.db.outbox.delete(entry.seq);
        this.assetAttempts.delete(asset.id);
      } catch {
        failed = true;
        const attempts = (this.assetAttempts.get(asset.id) ?? 0) + 1;
        this.assetAttempts.set(asset.id, attempts);
      }
    }
    if (failed) {
      const attempts = Math.max(...this.assetAttempts.values(), 1);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
      if (this.assetRetryTimer) clearTimeout(this.assetRetryTimer);
      this.assetRetryTimer = setTimeout(() => {
        this.assetRetryTimer = null;
        void this.syncNow('asset-retry');
      }, delay);
    }
  }

  async downloadAssetToLocal(assetId: string): Promise<boolean> {
    const found = await this.remote.downloadAsset(assetId);
    if (!found) return false;
    await this.db.assets.put({
      id: assetId,
      blob: found.blob,
      mime: found.blob.type || 'application/octet-stream',
      name: found.name,
      size: found.blob.size,
      driveFileId: assetId,
      uploadedAt: Date.now(),
    });
    return true;
  }

  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.assetRetryTimer) clearTimeout(this.assetRetryTimer);
  }
}
