/**
 * Minimal Google Drive REST v3 client over fetch (no gapi).
 * Implements the RemoteStore interface against the Mosaic/ folder layout:
 *   Mosaic/manifest.json
 *   Mosaic/boards/<boardId>.json
 *   Mosaic/assets/<assetId>
 */
import { getAccessToken, invalidateToken } from './googleAuth';
import type {
  BoardFile,
  Manifest,
  RemoteFileMeta,
  RemoteStore,
} from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,modifiedTime,headRevisionId';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function driveFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const tokenValue = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${tokenValue}`,
    },
  });
  if (res.status === 401 && retry) {
    invalidateToken();
    return driveFetch(url, init, false);
  }
  return res;
}

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`Drive ${what} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

function q(parts: string[]): string {
  return encodeURIComponent(parts.join(' and '));
}

async function listFiles(query: string[]): Promise<RemoteFileMeta[]> {
  const files: RemoteFileMeta[] = [];
  let pageToken = '';
  do {
    const res = await driveFetch(
      `${API}/files?q=${q(query)}&fields=nextPageToken,files(${FILE_FIELDS})&pageSize=200${
        pageToken ? `&pageToken=${pageToken}` : ''
      }`,
    );
    const data = await jsonOrThrow<{ files: RemoteFileMeta[]; nextPageToken?: string }>(
      res,
      'files.list',
    );
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const res = await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  const data = await jsonOrThrow<{ id: string }>(res, 'folder create');
  return data.id;
}

async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const query = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    ...(parentId ? [`'${parentId}' in parents`] : []),
  ];
  const found = await listFiles(query);
  return found[0]?.id ?? null;
}

function multipartBody(
  metadata: object,
  content: Blob | string,
  contentType: string,
): { body: Blob; boundary: string } {
  const boundary = `mosaic-${Math.random().toString(36).slice(2)}`;
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return { body: new Blob([head, content, tail]), boundary };
}

async function uploadMultipart(
  metadata: object,
  content: Blob | string,
  contentType: string,
  existingFileId?: string,
): Promise<RemoteFileMeta> {
  const { body, boundary } = multipartBody(metadata, content, contentType);
  const url = existingFileId
    ? `${UPLOAD}/files/${existingFileId}?uploadType=multipart&fields=${FILE_FIELDS}`
    : `${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`;
  const res = await driveFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (res.status === 404 && existingFileId) {
    // File vanished remotely (user deleted/moved it) — recreate from scratch.
    return uploadMultipart(metadata, content, contentType);
  }
  return jsonOrThrow<RemoteFileMeta>(res, 'upload');
}

async function downloadText(fileId: string): Promise<string | null> {
  const res = await driveFetch(`${API}/files/${fileId}?alt=media`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return res.text();
}

export async function fetchAccountInfo(): Promise<{ email: string; name: string }> {
  const res = await driveFetch(`${API}/about?fields=user`);
  const data = await jsonOrThrow<{ user?: { emailAddress?: string; displayName?: string } }>(
    res,
    'about.get',
  );
  return {
    email: data.user?.emailAddress ?? '',
    name: data.user?.displayName ?? '',
  };
}

/** Drive-backed RemoteStore. Folder ids are cached via the provided meta hooks. */
export function createDriveRemote(metaCache: {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}): RemoteStore {
  let rootId: string | null = null;
  let boardsId: string | null = null;
  let assetsId: string | null = null;
  let manifestFileId: string | null = null;

  async function ensureFolders(): Promise<void> {
    if (rootId && boardsId && assetsId) return;
    rootId = (await metaCache.get('drive:rootFolderId')) ?? null;
    boardsId = (await metaCache.get('drive:boardsFolderId')) ?? null;
    assetsId = (await metaCache.get('drive:assetsFolderId')) ?? null;

    // Validate cached ids still exist (user may have deleted the folder).
    if (rootId) {
      const res = await driveFetch(`${API}/files/${rootId}?fields=id,trashed`);
      if (!res.ok || ((await res.json()) as { trashed?: boolean }).trashed) {
        rootId = boardsId = assetsId = null;
      }
    }
    if (!rootId) {
      rootId = (await findFolder('Mosaic')) ?? (await createFolder('Mosaic'));
      boardsId = null;
      assetsId = null;
    }
    if (!boardsId) {
      boardsId = (await findFolder('boards', rootId)) ?? (await createFolder('boards', rootId));
    }
    if (!assetsId) {
      assetsId = (await findFolder('assets', rootId)) ?? (await createFolder('assets', rootId));
    }
    await metaCache.set('drive:rootFolderId', rootId);
    await metaCache.set('drive:boardsFolderId', boardsId);
    await metaCache.set('drive:assetsFolderId', assetsId);
  }

  async function findInFolder(name: string, folderId: string): Promise<RemoteFileMeta | null> {
    const files = await listFiles([
      `name = '${name.replace(/'/g, "\\'")}'`,
      `'${folderId}' in parents`,
      'trashed = false',
    ]);
    return files[0] ?? null;
  }

  return {
    async init() {
      await ensureFolders();
    },

    async getManifest() {
      await ensureFolders();
      const meta = await findInFolder('manifest.json', rootId!);
      if (!meta) return null;
      manifestFileId = meta.id;
      const text = await downloadText(meta.id);
      if (text === null) return null;
      try {
        return { meta, data: JSON.parse(text) as Manifest };
      } catch {
        return null; // corrupted manifest — caller recreates from local
      }
    },

    async putManifest(data) {
      await ensureFolders();
      if (!manifestFileId) {
        manifestFileId = (await findInFolder('manifest.json', rootId!))?.id ?? null;
      }
      const meta = await uploadMultipart(
        { name: 'manifest.json', ...(manifestFileId ? {} : { parents: [rootId!] }) },
        JSON.stringify(data),
        'application/json',
        manifestFileId ?? undefined,
      );
      manifestFileId = meta.id;
      return meta;
    },

    async listBoardFiles() {
      await ensureFolders();
      return listFiles([`'${boardsId!}' in parents`, 'trashed = false']);
    },

    async getBoardFile(boardId) {
      await ensureFolders();
      const meta = await findInFolder(`${boardId}.json`, boardsId!);
      if (!meta) return null;
      const text = await downloadText(meta.id);
      if (text === null) return null;
      try {
        return { meta, data: JSON.parse(text) as BoardFile };
      } catch {
        return null;
      }
    },

    async putBoardFile(boardId, data) {
      await ensureFolders();
      const existing = await findInFolder(`${boardId}.json`, boardsId!);
      return uploadMultipart(
        {
          name: `${boardId}.json`,
          ...(existing ? {} : { parents: [boardsId!] }),
        },
        JSON.stringify(data),
        'application/json',
        existing?.id,
      );
    },

    async uploadAsset(assetId, blob, name) {
      await ensureFolders();
      const existing = await findInFolder(assetId, assetsId!);
      return uploadMultipart(
        {
          name: assetId,
          appProperties: { originalName: name },
          ...(existing ? {} : { parents: [assetsId!] }),
        },
        blob,
        blob.type || 'application/octet-stream',
        existing?.id,
      );
    },

    async downloadAsset(assetId) {
      await ensureFolders();
      const meta = await findInFolder(assetId, assetsId!);
      if (!meta) return null;
      const res = await driveFetch(`${API}/files/${meta.id}?alt=media`);
      if (!res.ok) return null;
      return { blob: await res.blob(), name: meta.name };
    },
  };
}
