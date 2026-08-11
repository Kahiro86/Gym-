import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { validateBodyweightKg } from "../validation.js";
import type { GymDatabase } from "../db.js";
import type { BodyweightLogRecord } from "../types.js";

export interface NewBodyweightEntry {
  bodyweightKg: number;
  recordedAt: number;
}

export interface BodyweightRepository {
  log(input: NewBodyweightEntry): Promise<BodyweightLogRecord>;
  // Closest entry to `timestamp` on either side — for reconstructing what
  // the user's bodyweight probably was around a given moment in the past
  // (e.g. defaulting a new set's bodyweightKgAtTime before the user has
  // logged today's weigh-in).
  getNearest(timestamp: number): Promise<BodyweightLogRecord | null>;
  listRecent(limit: number): Promise<BodyweightLogRecord[]>;
  softDelete(id: string): Promise<void>;
}

// O(log n) nearest-neighbor search against an ALREADY sorted-by-recordedAt
// (ascending), already-deleted-filtered array. Exported so a bulk consumer
// (the derived-cache rebuild, task 14) can sort the whole log once and
// binary-search it per set — §7's actual perf concern is getNearest being
// called once per set in that rebuild's hot loop, not any single ad-hoc
// call from the repository below.
export function findNearestInSortedLog(sorted: BodyweightLogRecord[], timestamp: number): BodyweightLogRecord | null {
  if (sorted.length === 0) return null;

  // Binary search for the first index with recordedAt >= timestamp.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.recordedAt < timestamp) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0) return sorted[0]!;
  if (lo === sorted.length) return sorted[sorted.length - 1]!;

  const before = sorted[lo - 1]!;
  const after = sorted[lo]!;
  const beforeDiff = timestamp - before.recordedAt;
  const afterDiff = after.recordedAt - timestamp;
  return beforeDiff <= afterDiff ? before : after; // tie -> earlier
}

export function createBodyweightRepository(db: GymDatabase): BodyweightRepository {
  return {
    async log(input) {
      validateBodyweightKg(input.bodyweightKg);
      // Resolved before opening the transaction: getDeviceId() may itself
      // need to read/create the settings row, which db.settings isn't part
      // of this transaction's table set — Dexie requires a sub-transaction's
      // tables to be a subset of its parent's.
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.bodyweightLog, db.syncQueue, async () => {
        const record: BodyweightLogRecord = {
          id: newId(),
          bodyweightKg: input.bodyweightKg,
          recordedAt: input.recordedAt,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
          serverUpdatedAt: null,
        };
        await db.bodyweightLog.add(record);
        await enqueueSync(db, "bodyweightLog", record.id, "upsert");
        return record;
      });
    },

    async getNearest(timestamp) {
      // No .filter() chained onto the Dexie query — that forces per-row
      // cursor gets instead of one bulk fetch (see setRepository.ts for
      // the measured cost of that mistake). The log is small enough
      // (roughly one entry per day at most) that a full-table fetch per
      // call is fine; sort+filter happen in plain JS afterward.
      const rows = (await db.bodyweightLog.toArray()).filter((r) => r.deletedAt === null);
      rows.sort((a, b) => a.recordedAt - b.recordedAt);
      return findNearestInSortedLog(rows, timestamp);
    },

    async listRecent(limit) {
      const rows = await db.bodyweightLog.orderBy("recordedAt").reverse().toArray();
      return rows.filter((r) => r.deletedAt === null).slice(0, limit);
    },

    async softDelete(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.bodyweightLog, db.syncQueue, async () => {
        await db.bodyweightLog.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        // A soft delete still pushes the full row (with deletedAt set), so
        // it's an "upsert" from the sync transport's point of view — a
        // literal SQL DELETE would violate §2.5 (tombstones, never hard
        // deletes) and can't be represented this way anyway.
        await enqueueSync(db, "bodyweightLog", id, "upsert");
      });
    },
  };
}
