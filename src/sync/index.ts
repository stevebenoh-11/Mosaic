/**
 * App-side sync glue: wires the engine to the real Drive remote, the outbox
 * event, focus/interval pulls, and the status store. Sync is strictly a layer
 * on top of the local store — when disconnected nothing else changes.
 */
import { db, getMeta, setMeta } from '@/db/schema';
import { useStore } from '@/store';
import { OUTBOX_EVENT } from '@/store/persister';
import { setRemoteAssetFetcher } from '@/db/assets';
import {
  AuthError,
  connectInteractive,
  getClientId,
  revokeAndForget,
} from './googleAuth';
import { createDriveRemote, fetchAccountInfo } from './driveClient';
import { SyncEngine } from './engine';
import { useSyncStore } from './status';
import type { SyncLogEntry } from './types';

let engine: SyncEngine | null = null;
let pullInterval: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;

function setState(...args: Parameters<ReturnType<typeof useSyncStore.getState>['set']>) {
  useSyncStore.getState().set(...args);
}

async function refreshAppFromDb(boardIds: string[]): Promise<void> {
  const store = useStore.getState();
  // Boards list may have changed regardless of which board is open.
  const boards = await db.boards.toArray();
  const map: Record<string, (typeof boards)[number]> = {};
  for (const b of boards) map[b.id] = b;
  useStore.setState({ boards: map });

  const current = store.currentBoardId;
  if (current && boardIds.includes(current)) {
    const rows = await db.elements.where('boardId').equals(current).toArray();
    const editing = useStore.getState().editingElementId;
    const elements: Record<string, (typeof rows)[number]> = {};
    for (const e of rows) elements[e.id] = e;
    // Don't clobber an element mid-edit; keep the local version.
    if (editing && useStore.getState().elements[editing]) {
      const localEditing = useStore.getState().elements[editing]!;
      elements[editing] = localEditing;
    }
    const selection = useStore
      .getState()
      .selection.filter((id) => elements[id] !== undefined);
    useStore.setState({ elements, selection });
  }
}

function buildEngine(deviceId: string): SyncEngine {
  const remote = createDriveRemote({
    get: (key) => getMeta<string>(key),
    set: (key, value) => setMeta(key, value),
  });
  return new SyncEngine(db, remote, deviceId, {
    onStatus: (status, detail) => {
      setState({ status, statusDetail: detail ?? null });
      if (status === 'synced') setState({ lastSyncedAt: Date.now() });
    },
    onRemoteApplied: (boardIds) => void refreshAppFromDb(boardIds),
    onLog: (log: SyncLogEntry[]) => setState({ log }),
  });
}

async function startEngine(): Promise<void> {
  const deviceId = useStore.getState().deviceId;
  engine = buildEngine(deviceId);

  setRemoteAssetFetcher(async (assetId) => {
    if (!engine) return false;
    try {
      return await engine.downloadAssetToLocal(assetId);
    } catch {
      return false;
    }
  });

  if (!listenersBound) {
    listenersBound = true;
    window.addEventListener(OUTBOX_EVENT, () => engine?.schedulePush());
    window.addEventListener('focus', () => void safeSync('focus'));
    window.addEventListener('online', () => void safeSync('online'));
  }
  if (pullInterval) clearInterval(pullInterval);
  pullInterval = setInterval(() => {
    if (document.visibilityState === 'visible') void safeSync('interval');
  }, 30_000);

  await safeSync('start');
}

async function safeSync(reason: string): Promise<void> {
  if (!engine) return;
  try {
    await useStore.getState().flushNow();
    await engine.syncNow(reason);
  } catch {
    // Status already reported by the engine.
  }
}

/** Queue every local entity so the first push uploads the full workspace. */
async function enqueueEverything(): Promise<void> {
  const now = Date.now();
  const boards = await db.boards.toArray();
  const elements = await db.elements.toArray();
  const assets = await db.assets.toArray();
  await db.outbox.bulkAdd([
    ...boards.map((b) => ({
      entityType: 'board' as const,
      entityId: b.id,
      boardId: null,
      queuedAt: now,
    })),
    ...elements.map((e) => ({
      entityType: 'element' as const,
      entityId: e.id,
      boardId: e.boardId,
      queuedAt: now,
    })),
    ...assets
      .filter((a) => !a.driveFileId)
      .map((a) => ({
        entityType: 'asset' as const,
        entityId: a.id,
        boardId: null,
        queuedAt: now,
      })),
  ]);
}

/** Called once at app startup (after the store is ready). */
export async function initSync(): Promise<void> {
  const clientIdPresent = getClientId() !== null;
  const connected = (await getMeta<boolean>('sync:connected')) ?? false;
  const account =
    (await getMeta<{ email: string; name: string }>('sync:account')) ?? null;
  const lastSyncedAt = (await getMeta<number>('sync:lastSyncedAt')) ?? null;
  const log = (await getMeta<SyncLogEntry[]>('sync:log')) ?? [];
  setState({
    clientIdPresent,
    connected,
    account,
    lastSyncedAt,
    log,
    status: connected ? 'paused' : 'disabled',
    statusDetail: null,
  });
  if (connected && clientIdPresent) {
    // Reconnect silently in the background; failure leaves us paused with a
    // Reconnect button — local editing is never blocked.
    await startEngine();
  }
}

export async function connectDrive(): Promise<void> {
  await connectInteractive(); // throws AuthError on popup-block/denial
  const account = await fetchAccountInfo();
  await setMeta('sync:connected', true);
  await setMeta('sync:account', account);
  setState({ connected: true, account });
  await enqueueEverything();
  await startEngine();
}

export async function reconnectDrive(): Promise<void> {
  await connectInteractive();
  if (!engine) await startEngine();
  else await safeSync('reconnect');
}

export async function disconnectDrive(): Promise<void> {
  revokeAndForget();
  engine?.dispose();
  engine = null;
  if (pullInterval) clearInterval(pullInterval);
  pullInterval = null;
  // Clear sync bookkeeping; ALL local data stays.
  const syncKeys = (await db.meta.toArray())
    .map((r) => r.key)
    .filter((k) => k.startsWith('sync:') || k.startsWith('drive:'));
  await db.meta.bulkDelete(syncKeys);
  setState({
    connected: false,
    account: null,
    status: 'disabled',
    statusDetail: null,
    lastSyncedAt: null,
    log: [],
  });
}

export function syncNowManual(): Promise<void> {
  return safeSync('manual');
}

export { AuthError };
