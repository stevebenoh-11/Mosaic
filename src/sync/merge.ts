/**
 * Pure last-write-wins merge over versioned rows + tombstones.
 *
 * Rules (per entity id):
 * - The newest operation wins, comparing `updatedAt` (rows) vs `deletedAt`
 *   (tombstones). A deletion newer than an edit deletes; an edit newer than a
 *   deletion resurrects.
 * - Exact-timestamp ties break deterministically: deletion beats edit, then
 *   the higher writer deviceId wins.
 */

export interface VersionedRow {
  id: string;
  updatedAt: number;
  modifiedBy?: string;
}

export interface TombRecord {
  id: string;
  deletedAt: number;
  deletedBy?: string;
}

interface Op {
  kind: 'row' | 'tomb';
  at: number;
  by: string;
}

function newerOp(a: Op | null, b: Op | null): Op | null {
  if (!a) return b;
  if (!b) return a;
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (a.kind !== b.kind) return a.kind === 'tomb' ? a : b; // delete wins ties
  return a.by >= b.by ? a : b;
}

export interface MergeResult<T extends VersionedRow> {
  /** Surviving rows after the merge. */
  rows: T[];
  /** Surviving tombstones (deletions that won). */
  tombs: TombRecord[];
  /** Ids whose local state must change (apply remote / delete locally). */
  applyLocally: { rows: T[]; deletions: TombRecord[] };
  /** True when the merged result differs from the remote inputs (needs push). */
  remoteChanged: boolean;
  /** Human-readable conflict resolutions (both sides had competing ops). */
  conflicts: { id: string; resolution: string }[];
}

export function mergeSets<T extends VersionedRow>(
  localRows: T[],
  localTombs: TombRecord[],
  remoteRows: T[],
  remoteTombs: TombRecord[],
): MergeResult<T> {
  const ids = new Set<string>();
  const lr = new Map(localRows.map((r) => [r.id, r]));
  const lt = new Map(localTombs.map((t) => [t.id, t]));
  const rr = new Map(remoteRows.map((r) => [r.id, r]));
  const rt = new Map(remoteTombs.map((t) => [t.id, t]));
  for (const m of [lr, lt, rr, rt]) for (const id of m.keys()) ids.add(id);

  const rows: T[] = [];
  const tombs: TombRecord[] = [];
  const applyRows: T[] = [];
  const applyDeletions: TombRecord[] = [];
  let remoteChanged = false;
  const conflicts: { id: string; resolution: string }[] = [];

  for (const id of ids) {
    const lRow = lr.get(id) ?? null;
    const lTomb = lt.get(id) ?? null;
    const rRow = rr.get(id) ?? null;
    const rTomb = rt.get(id) ?? null;

    const lOp: Op | null = (() => {
      const a: Op | null = lRow
        ? { kind: 'row', at: lRow.updatedAt, by: lRow.modifiedBy ?? '' }
        : null;
      const b: Op | null = lTomb
        ? { kind: 'tomb', at: lTomb.deletedAt, by: lTomb.deletedBy ?? '' }
        : null;
      return newerOp(a, b);
    })();
    const rOp: Op | null = (() => {
      const a: Op | null = rRow
        ? { kind: 'row', at: rRow.updatedAt, by: rRow.modifiedBy ?? '' }
        : null;
      const b: Op | null = rTomb
        ? { kind: 'tomb', at: rTomb.deletedAt, by: rTomb.deletedBy ?? '' }
        : null;
      return newerOp(a, b);
    })();

    const winner = newerOp(lOp, rOp);
    if (!winner) continue;
    const winnerIsLocal = winner === lOp;
    const winnerRow = winnerIsLocal
      ? winner.kind === 'row'
        ? lRow
        : null
      : winner.kind === 'row'
        ? rRow
        : null;
    const winnerTomb = winnerIsLocal
      ? winner.kind === 'tomb'
        ? lTomb
        : null
      : winner.kind === 'tomb'
        ? rTomb
        : null;

    if (winnerRow) {
      rows.push(winnerRow);
      // Local must adopt the remote row when remote won with a row.
      if (!winnerIsLocal) {
        const same =
          lRow &&
          lRow.updatedAt === winnerRow.updatedAt &&
          (lRow.modifiedBy ?? '') === (winnerRow.modifiedBy ?? '');
        if (!same) {
          applyRows.push(winnerRow);
          if (lOp) {
            conflicts.push({
              id,
              resolution: lOp.kind === 'tomb' ? 'remote edit beat local delete' : 'remote edit won',
            });
          }
        }
      }
      // Remote must adopt when local won with a row that remote lacks/lags.
      if (winnerIsLocal) {
        const same =
          rRow &&
          rRow.updatedAt === winnerRow.updatedAt &&
          (rRow.modifiedBy ?? '') === (winnerRow.modifiedBy ?? '');
        if (!same) {
          remoteChanged = true;
          if (rOp) {
            conflicts.push({
              id,
              resolution: rOp.kind === 'tomb' ? 'local edit beat remote delete' : 'local edit won',
            });
          }
        }
      }
    } else if (winnerTomb) {
      tombs.push(winnerTomb);
      if (!winnerIsLocal && lRow) {
        applyDeletions.push(winnerTomb);
        conflicts.push({ id, resolution: 'remote delete beat local edit' });
      } else if (!winnerIsLocal && !lTomb) {
        // Remote deletion of something we never had a row for: record it.
        applyDeletions.push(winnerTomb);
      }
      if (winnerIsLocal && (rRow || !rTomb)) {
        remoteChanged = true;
        if (rRow) conflicts.push({ id, resolution: 'local delete beat remote edit' });
      }
    }
  }

  return {
    rows,
    tombs,
    applyLocally: { rows: applyRows, deletions: applyDeletions },
    remoteChanged,
    conflicts,
  };
}
