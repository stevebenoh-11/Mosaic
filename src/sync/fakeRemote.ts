/**
 * In-memory RemoteStore with revision counters — a fake Drive for tests.
 * Two engine instances pointed at the same FakeRemote simulate two devices.
 */
import type {
  BoardFile,
  Manifest,
  RemoteFileMeta,
  RemoteStore,
} from './types';

export class FakeRemote implements RemoteStore {
  manifest: { data: Manifest; rev: number } | null = null;
  boards = new Map<string, { data: BoardFile; rev: number }>();
  assets = new Map<string, { blob: Blob; name: string }>();
  /** Simulate network failure when true. */
  offline = false;
  putCount = 0;

  private check(): void {
    if (this.offline) throw new TypeError('Failed to fetch');
  }

  private meta(id: string, name: string, rev: number): RemoteFileMeta {
    return {
      id,
      name,
      modifiedTime: new Date(rev).toISOString(),
      headRevisionId: String(rev),
    };
  }

  async init(): Promise<void> {
    this.check();
  }

  async getManifest() {
    this.check();
    if (!this.manifest) return null;
    return {
      meta: this.meta('manifest', 'manifest.json', this.manifest.rev),
      data: structuredClone(this.manifest.data),
    };
  }

  async putManifest(data: Manifest): Promise<RemoteFileMeta> {
    this.check();
    this.putCount++;
    const rev = (this.manifest?.rev ?? 0) + 1;
    this.manifest = { data: structuredClone(data), rev };
    return this.meta('manifest', 'manifest.json', rev);
  }

  async listBoardFiles(): Promise<RemoteFileMeta[]> {
    this.check();
    return [...this.boards.entries()].map(([id, f]) =>
      this.meta(`file-${id}`, `${id}.json`, f.rev),
    );
  }

  async getBoardFile(boardId: string) {
    this.check();
    const f = this.boards.get(boardId);
    if (!f) return null;
    return {
      meta: this.meta(`file-${boardId}`, `${boardId}.json`, f.rev),
      data: structuredClone(f.data),
    };
  }

  async putBoardFile(boardId: string, data: BoardFile): Promise<RemoteFileMeta> {
    this.check();
    this.putCount++;
    const rev = (this.boards.get(boardId)?.rev ?? 0) + 1;
    this.boards.set(boardId, { data: structuredClone(data), rev });
    return this.meta(`file-${boardId}`, `${boardId}.json`, rev);
  }

  async uploadAsset(assetId: string, blob: Blob, name: string): Promise<RemoteFileMeta> {
    this.check();
    this.assets.set(assetId, { blob, name });
    return this.meta(`asset-${assetId}`, assetId, 1);
  }

  async downloadAsset(assetId: string) {
    this.check();
    return this.assets.get(assetId) ?? null;
  }
}
