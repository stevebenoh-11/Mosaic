/**
 * Two-device sync simulations: two Dexie databases (fake-indexeddb) syncing
 * through a FakeRemote with revision counters.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { MosaicDB } from '@/db/schema';
import type { Board, Element, NoteContent } from '@/db/types';
import { SyncEngine } from './engine';
import { FakeRemote } from './fakeRemote';
import type { SyncLogEntry } from './types';

let dbCounter = 0;
const openDbs: MosaicDB[] = [];

interface Device {
  id: string;
  db: MosaicDB;
  engine: SyncEngine;
  log: SyncLogEntry[];
  addBoard(id: string, title: string, at: number): Promise<void>;
  addNote(boardId: string, id: string, text: string, at: number): Promise<void>;
  editNote(id: string, text: string, at: number): Promise<void>;
  deleteElement(id: string, boardId: string, at: number): Promise<void>;
  deleteBoard(id: string, at: number): Promise<void>;
  noteText(id: string): Promise<string | null>;
  elementIds(boardId: string): Promise<string[]>;
  boardIds(): Promise<string[]>;
  sync(): Promise<void>;
}

function noteContent(text: string): NoteContent {
  return {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  };
}

async function makeDevice(deviceId: string, remote: FakeRemote): Promise<Device> {
  const db = new MosaicDB(`test-${deviceId}-${++dbCounter}-${Date.now()}`);
  openDbs.push(db);
  const log: SyncLogEntry[] = [];
  const engine = new SyncEngine(db, remote, deviceId, {
    onLog: (entries) => {
      log.length = 0;
      log.push(...entries);
    },
  });

  async function queue(entityType: 'board' | 'element', entityId: string, boardId: string | null, at: number) {
    await db.outbox.add({ entityType, entityId, boardId, queuedAt: at });
  }

  return {
    id: deviceId,
    db,
    engine,
    log,
    async addBoard(id, title, at) {
      const board: Board = {
        id,
        title,
        parentBoardId: null,
        sortIndex: 0,
        createdAt: at,
        updatedAt: at,
        modifiedBy: deviceId,
      };
      await db.boards.put(board);
      await queue('board', id, null, at);
    },
    async addNote(boardId, id, text, at) {
      const el: Element = {
        id,
        boardId,
        type: 'note',
        x: 0,
        y: 0,
        w: 200,
        h: 60,
        zIndex: 1,
        parentColumnId: null,
        sortIndex: 0,
        content: noteContent(text),
        style: {},
        createdAt: at,
        updatedAt: at,
        modifiedBy: deviceId,
      };
      await db.elements.put(el);
      await queue('element', id, boardId, at);
    },
    async editNote(id, text, at) {
      const el = await db.elements.get(id);
      if (!el) throw new Error(`no element ${id}`);
      await db.elements.put({
        ...el,
        content: noteContent(text),
        updatedAt: at,
        modifiedBy: deviceId,
      });
      await queue('element', id, el.boardId, at);
    },
    async deleteElement(id, boardId, at) {
      await db.elements.delete(id);
      await db.tombstones.put({
        id,
        entityType: 'element',
        deletedAt: at,
        boardId,
        deletedBy: deviceId,
      });
      await queue('element', id, boardId, at);
    },
    async deleteBoard(id, at) {
      await db.boards.delete(id);
      await db.elements.where('boardId').equals(id).delete();
      await db.tombstones.put({
        id,
        entityType: 'board',
        deletedAt: at,
        deletedBy: deviceId,
      });
      await queue('board', id, null, at);
    },
    async noteText(id) {
      const el = await db.elements.get(id);
      if (!el) return null;
      return JSON.stringify(el.content).match(/"text":"([^"]*)"/)?.[1] ?? '';
    },
    async elementIds(boardId) {
      return (await db.elements.where('boardId').equals(boardId).toArray())
        .map((e) => e.id)
        .sort();
    },
    async boardIds() {
      return (await db.boards.toArray()).map((b) => b.id).sort();
    },
    sync: () => engine.syncNow('test'),
  };
}

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete().catch(() => undefined);
  }
});

describe('two-device sync', () => {
  it('concurrent edits to DIFFERENT elements merge on both sides', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    const b = await makeDevice('devB', remote);

    await a.addBoard('board1', 'Shared', 1000);
    await a.addNote('board1', 'noteA', 'from A', 1001);
    await a.sync();
    await b.sync(); // B pulls board + noteA

    expect(await b.elementIds('board1')).toEqual(['noteA']);

    // Both edit concurrently: A adds noteA2, B adds noteB1.
    await a.addNote('board1', 'noteA2', 'A again', 2000);
    await b.addNote('board1', 'noteB1', 'from B', 2001);
    await a.sync();
    await b.sync();
    await a.sync();

    expect(await a.elementIds('board1')).toEqual(['noteA', 'noteA2', 'noteB1']);
    expect(await b.elementIds('board1')).toEqual(['noteA', 'noteA2', 'noteB1']);
  });

  it('concurrent edits to the SAME element resolve by LWW with a logged conflict', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    const b = await makeDevice('devB', remote);

    await a.addBoard('board1', 'Shared', 1000);
    await a.addNote('board1', 'n1', 'original', 1001);
    await a.sync();
    await b.sync();

    await a.editNote('n1', 'A version', 2000); // older
    await b.editNote('n1', 'B version', 3000); // newer
    await a.sync();
    await b.sync(); // B merges: B newer → keeps B, flags push
    await a.sync(); // A pulls B's winning version

    expect(await a.noteText('n1')).toBe('B version');
    expect(await b.noteText('n1')).toBe('B version');
    const allLogs = [...a.log, ...b.log].map((l) => l.resolution).join('|');
    expect(allLogs).toMatch(/edit (won|beat)/);
  });

  it('delete-vs-edit: the newer operation wins in both directions', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    const b = await makeDevice('devB', remote);

    await a.addBoard('board1', 'Shared', 1000);
    await a.addNote('board1', 'doomed', 'x', 1001);
    await a.addNote('board1', 'phoenix', 'y', 1002);
    await a.sync();
    await b.sync();

    // doomed: B edits at 2000, A deletes at 3000 → deletion wins.
    await b.editNote('doomed', 'edited', 2000);
    await a.deleteElement('doomed', 'board1', 3000);
    // phoenix: A deletes at 2000, B edits at 3000 → edit wins (resurrects).
    await a.deleteElement('phoenix', 'board1', 2000);
    await b.editNote('phoenix', 'survived', 3000);

    await a.sync();
    await b.sync();
    await a.sync();

    expect(await a.elementIds('board1')).toEqual(['phoenix']);
    expect(await b.elementIds('board1')).toEqual(['phoenix']);
    expect(await a.noteText('phoenix')).toBe('survived');
  });

  it('offline queue flush: edits made offline land after reconnect', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    const b = await makeDevice('devB', remote);

    await a.addBoard('board1', 'Shared', 1000);
    await a.sync();
    await b.sync();

    remote.offline = true;
    await b.addNote('board1', 'off1', 'offline note 1', 2000);
    await b.addNote('board1', 'off2', 'offline note 2', 2001);
    await expect(b.sync()).rejects.toThrow(); // network down, outbox keeps rows
    expect(await b.db.outbox.count()).toBeGreaterThan(0);

    remote.offline = false;
    await b.sync();
    expect(await b.db.outbox.count()).toBe(0);
    await a.sync();
    expect(await a.elementIds('board1')).toEqual(['off1', 'off2']);
  });

  it('first connect with local AND remote data merges element-by-element', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    await a.addBoard('boardA', 'A board', 1000);
    await a.addNote('boardA', 'a1', 'A content', 1001);
    await a.sync();

    // Device B has its own pre-existing local data, then connects.
    const b = await makeDevice('devB', remote);
    await b.addBoard('boardB', 'B board', 1500);
    await b.addNote('boardB', 'b1', 'B content', 1501);
    await b.sync(); // first connect: pull merges remote, push uploads local

    expect(await b.boardIds()).toEqual(['boardA', 'boardB']);
    await a.sync();
    expect(await a.boardIds()).toEqual(['boardA', 'boardB']);
    expect(await a.elementIds('boardB')).toEqual(['b1']);
    expect(await b.elementIds('boardA')).toEqual(['a1']);
  });

  it('board deletion propagates and re-syncs cleanly', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    const b = await makeDevice('devB', remote);

    await a.addBoard('temp', 'Temp', 1000);
    await a.addNote('temp', 't1', 'bye', 1001);
    await a.sync();
    await b.sync();
    expect(await b.boardIds()).toContain('temp');

    await a.deleteBoard('temp', 2000);
    await a.sync();
    await b.sync();
    expect(await b.boardIds()).not.toContain('temp');
    expect(await b.elementIds('temp')).toEqual([]);
  });

  it('read-merge-write: concurrent pushes do not clobber each other', async () => {
    const remote = new FakeRemote();
    const a = await makeDevice('devA', remote);
    const b = await makeDevice('devB', remote);

    await a.addBoard('board1', 'Shared', 1000);
    await a.sync();
    await b.sync();

    // A pushes a new element; B then pushes its own WITHOUT pulling first.
    await a.addNote('board1', 'fromA', 'a', 2000);
    await a.sync();
    await b.addNote('board1', 'fromB', 'b', 2001);
    await b.sync(); // B must merge A's file before uploading

    const file = remote.boards.get('board1')!.data;
    const ids = file.elements.map((e) => e.id).sort();
    expect(ids).toEqual(['fromA', 'fromB']);
  });
});
