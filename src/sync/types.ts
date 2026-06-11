import type { Board, Element } from '@/db/types';

export interface ManifestBoardEntry {
  id: string;
  title: string;
  parentBoardId: string | null;
  sortIndex: number;
  updatedAt: number;
  modifiedBy?: string;
  deleted?: boolean;
  deletedAt?: number;
}

export interface Manifest {
  schemaVersion: number;
  boards: ManifestBoardEntry[];
  lastCompactedAt: number;
}

export interface BoardFileTombstone {
  id: string;
  deletedAt: number;
  deletedBy?: string;
}

export interface BoardFile {
  schemaVersion: number;
  board: Board;
  elements: Element[];
  tombstones: BoardFileTombstone[];
}

export interface RemoteFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
  headRevisionId: string;
}

/**
 * Abstraction over the Drive layout. The real implementation talks to the
 * Drive REST API; tests use an in-memory fake with revision counters.
 */
export interface RemoteStore {
  /** Ensure folders exist; idempotent. */
  init(): Promise<void>;
  getManifest(): Promise<{ meta: RemoteFileMeta; data: Manifest } | null>;
  putManifest(data: Manifest): Promise<RemoteFileMeta>;
  /** List board files with their revision metadata. */
  listBoardFiles(): Promise<RemoteFileMeta[]>;
  getBoardFile(boardId: string): Promise<{ meta: RemoteFileMeta; data: BoardFile } | null>;
  putBoardFile(boardId: string, data: BoardFile): Promise<RemoteFileMeta>;
  uploadAsset(assetId: string, blob: Blob, name: string): Promise<RemoteFileMeta>;
  downloadAsset(assetId: string): Promise<{ blob: Blob; name: string } | null>;
}

export type SyncStatus = 'disabled' | 'synced' | 'syncing' | 'offline' | 'paused';

export interface SyncLogEntry {
  at: number;
  boardId: string | null;
  entityId: string;
  resolution: string;
}
