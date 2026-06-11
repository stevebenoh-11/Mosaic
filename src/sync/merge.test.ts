import { describe, expect, it } from 'vitest';
import { mergeSets, type VersionedRow } from './merge';

const row = (id: string, updatedAt: number, by = 'dev', extra = ''): VersionedRow & { extra?: string } => ({
  id,
  updatedAt,
  modifiedBy: by,
  ...(extra ? { extra } : {}),
});

describe('mergeSets', () => {
  it('takes the newer remote row', () => {
    const r = mergeSets([row('a', 100, 'x')], [], [row('a', 200, 'y')], []);
    expect(r.rows[0]?.updatedAt).toBe(200);
    expect(r.applyLocally.rows).toHaveLength(1);
    expect(r.remoteChanged).toBe(false);
  });

  it('keeps the newer local row and flags remote for push', () => {
    const r = mergeSets([row('a', 300, 'x')], [], [row('a', 200, 'y')], []);
    expect(r.rows[0]?.updatedAt).toBe(300);
    expect(r.applyLocally.rows).toHaveLength(0);
    expect(r.remoteChanged).toBe(true);
  });

  it('union of disjoint rows', () => {
    const r = mergeSets([row('a', 100)], [], [row('b', 100)], []);
    expect(r.rows).toHaveLength(2);
    expect(r.applyLocally.rows.map((x) => x.id)).toEqual(['b']);
    expect(r.remoteChanged).toBe(true);
  });

  it('newer deletion beats older edit', () => {
    const r = mergeSets(
      [row('a', 100)],
      [],
      [],
      [{ id: 'a', deletedAt: 200, deletedBy: 'y' }],
    );
    expect(r.rows).toHaveLength(0);
    expect(r.applyLocally.deletions).toHaveLength(1);
    expect(r.conflicts[0]?.resolution).toContain('remote delete');
  });

  it('newer edit resurrects over older deletion', () => {
    const r = mergeSets(
      [row('a', 300)],
      [],
      [],
      [{ id: 'a', deletedAt: 200, deletedBy: 'y' }],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.applyLocally.deletions).toHaveLength(0);
    expect(r.remoteChanged).toBe(true);
  });

  it('exact-tie between rows breaks by deviceId (deterministic both ways)', () => {
    const a = mergeSets([row('a', 100, 'aaa')], [], [row('a', 100, 'zzz')], []);
    expect(a.rows[0]?.modifiedBy).toBe('zzz');
    const b = mergeSets([row('a', 100, 'zzz')], [], [row('a', 100, 'aaa')], []);
    expect(b.rows[0]?.modifiedBy).toBe('zzz');
  });

  it('exact-tie between edit and delete: delete wins', () => {
    const r = mergeSets(
      [row('a', 100, 'aaa')],
      [],
      [],
      [{ id: 'a', deletedAt: 100, deletedBy: 'aaa' }],
    );
    expect(r.rows).toHaveLength(0);
    expect(r.tombs).toHaveLength(1);
  });

  it('local deletion propagates to remote', () => {
    const r = mergeSets(
      [],
      [{ id: 'a', deletedAt: 300, deletedBy: 'x' }],
      [row('a', 200, 'y')],
      [],
    );
    expect(r.rows).toHaveLength(0);
    expect(r.remoteChanged).toBe(true);
    expect(r.conflicts[0]?.resolution).toContain('local delete');
  });
});
