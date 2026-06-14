import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { db } from '@/db/schema';
import { useStore } from '@/store';
import type { Asset, Board, Element, LineContent } from '@/db/types';

const PAD = 48;

function contentBounds(elements: Element[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const el of elements) {
    if (el.parentColumnId !== null) continue;
    if (el.type === 'line') {
      const c = el.content as LineContent;
      for (const end of [c.from, c.to]) {
        if ('point' in end) extend(end.point.x, end.point.y);
      }
      continue;
    }
    extend(el.x, el.y);
    extend(el.x + el.w, el.y + el.h);
  }
  if (minX === Infinity) return null;
  return { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(title: string): string {
  return (title || 'board').replace(/[^\w\-]+/g, '-').slice(0, 60);
}

/** Render the current board's world DOM to a 2x PNG data URL. */
async function renderBoardPng(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const state = useStore.getState();
  const boardId = state.currentBoardId;
  if (!boardId) return null;
  const elements = Object.values(state.elements).filter((e) => e.boardId === boardId);
  const bounds = contentBounds(elements);
  const world = document.querySelector('[data-world]');
  if (!bounds || !(world instanceof HTMLElement)) return null;

  state.setSelection([]);
  await new Promise((r) => setTimeout(r, 50)); // let selection rings clear

  const dataUrl = await toPng(world, {
    width: Math.round(bounds.w),
    height: Math.round(bounds.h),
    pixelRatio: 2,
    backgroundColor: '#F5F4F0',
    style: {
      transform: `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`,
      transformOrigin: 'top left',
    },
  });
  return { dataUrl, w: Math.round(bounds.w), h: Math.round(bounds.h) };
}

export async function exportPng(): Promise<boolean> {
  const res = await renderBoardPng();
  if (!res) return false;
  const state = useStore.getState();
  const title = state.boards[state.currentBoardId ?? '']?.title ?? 'board';
  const blob = await (await fetch(res.dataUrl)).blob();
  download(blob, `${safeName(title)}.png`);
  return true;
}

export async function exportPdf(): Promise<boolean> {
  const res = await renderBoardPng();
  if (!res) return false;
  const state = useStore.getState();
  const title = state.boards[state.currentBoardId ?? '']?.title ?? 'board';
  // 96 css px per inch → pt = px * 72/96.
  const wPt = (res.w * 72) / 96;
  const hPt = (res.h * 72) / 96;
  const pdf = new jsPDF({
    orientation: wPt >= hPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [wPt, hPt],
  });
  pdf.addImage(res.dataUrl, 'PNG', 0, 0, wPt, hPt);
  pdf.save(`${safeName(title)}.pdf`);
  return true;
}

export async function exportBoardJson(): Promise<boolean> {
  const state = useStore.getState();
  const boardId = state.currentBoardId;
  if (!boardId) return false;
  const board = state.boards[boardId];
  const elements = await db.elements.where('boardId').equals(boardId).toArray();
  const blob = new Blob(
    [JSON.stringify({ schemaVersion: 1, board, elements }, null, 2)],
    { type: 'application/json' },
  );
  download(blob, `${safeName(board?.title ?? 'board')}.json`);
  return true;
}

interface BackupManifest {
  schemaVersion: number;
  exportedAt: number;
  boards: Board[];
  elements: Element[];
  assets: { id: string; mime: string; name: string; size: number; width?: number; height?: number }[];
}

export async function exportBackupZip(): Promise<void> {
  const zip = new JSZip();
  const boards = await db.boards.toArray();
  const elements = await db.elements.toArray();
  const assets = await db.assets.toArray();

  const manifest: BackupManifest = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    boards,
    elements,
    assets: assets.map(({ id, mime, name, size, width, height }) => {
      const meta: BackupManifest['assets'][number] = { id, mime, name, size };
      if (width !== undefined) meta.width = width;
      if (height !== undefined) meta.height = height;
      return meta;
    }),
  };
  zip.file('workspace.json', JSON.stringify(manifest, null, 2));
  const folder = zip.folder('assets')!;
  for (const a of assets) {
    folder.file(a.id, a.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const stamp = new Date().toISOString().slice(0, 10);
  download(blob, `mosaic-backup-${stamp}.zip`);
}

// Backup zips are untrusted input: validate row shapes before they reach the
// database, and scrub link URLs that could smuggle javascript: hrefs.
function isValidBoard(obj: unknown): obj is Board {
  const b = obj as Record<string, unknown>;
  return (
    !!b &&
    typeof b.id === 'string' &&
    typeof b.title === 'string' &&
    (b.parentBoardId === null || typeof b.parentBoardId === 'string') &&
    typeof b.sortIndex === 'number' &&
    typeof b.createdAt === 'number' &&
    typeof b.updatedAt === 'number'
  );
}

function isValidElement(obj: unknown): obj is Element {
  const e = obj as Record<string, unknown>;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.boardId === 'string' &&
    typeof e.type === 'string' &&
    typeof e.x === 'number' &&
    typeof e.y === 'number' &&
    typeof e.w === 'number' &&
    typeof e.h === 'number' &&
    typeof e.zIndex === 'number' &&
    typeof e.content === 'object' &&
    e.content !== null
  );
}

function scrubElement(el: Element): Element {
  if (el.type !== 'link') return el;
  const c = el.content as { url?: unknown };
  if (typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) return el;
  return { ...el, content: { ...(el.content as object), url: '' } };
}

/** Restore a backup zip, REPLACING the current workspace. */
export async function importBackupZip(file: File): Promise<{ boards: number; elements: number }> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('workspace.json');
  if (!manifestFile) throw new Error('Not a Mosaic backup (workspace.json missing)');
  const manifest = JSON.parse(await manifestFile.async('text')) as BackupManifest;
  if (!Array.isArray(manifest.boards) || !Array.isArray(manifest.elements)) {
    throw new Error('Backup manifest is malformed');
  }
  manifest.boards = manifest.boards.filter(isValidBoard);
  manifest.elements = manifest.elements.filter(isValidElement).map(scrubElement);
  if (manifest.boards.length === 0) {
    throw new Error('Backup contains no valid boards');
  }

  const assets: Asset[] = [];
  for (const meta of manifest.assets ?? []) {
    const entry = zip.file(`assets/${meta.id}`);
    if (!entry) continue;
    const data = await entry.async('blob');
    const asset: Asset = {
      id: meta.id,
      blob: new Blob([data], { type: meta.mime }),
      mime: meta.mime,
      name: meta.name,
      size: meta.size,
    };
    if (meta.width !== undefined) asset.width = meta.width;
    if (meta.height !== undefined) asset.height = meta.height;
    assets.push(asset);
  }

  await db.transaction(
    'rw',
    [db.boards, db.elements, db.assets, db.tombstones, db.outbox],
    async () => {
      await Promise.all([
        db.boards.clear(),
        db.elements.clear(),
        db.assets.clear(),
        db.tombstones.clear(),
        db.outbox.clear(),
      ]);
      await db.boards.bulkAdd(manifest.boards);
      await db.elements.bulkAdd(manifest.elements);
      if (assets.length > 0) await db.assets.bulkAdd(assets);
      // Everything restored is "dirty" for sync purposes.
      const now = Date.now();
      await db.outbox.bulkAdd([
        ...manifest.boards.map((b) => ({
          entityType: 'board' as const,
          entityId: b.id,
          boardId: null,
          queuedAt: now,
        })),
        ...manifest.elements.map((e) => ({
          entityType: 'element' as const,
          entityId: e.id,
          boardId: e.boardId,
          queuedAt: now,
        })),
      ]);
    },
  );
  return { boards: manifest.boards.length, elements: manifest.elements.length };
}
