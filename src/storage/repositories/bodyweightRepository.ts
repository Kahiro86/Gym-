import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
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

export function createBodyweightRepository(db: GymDatabase): BodyweightRepository {
  return {
    async log(input) {
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
        };
        await db.bodyweightLog.add(record);
        await enqueueSync(db, "bodyweightLog", record.id, "upsert");
        return record;
      });
    },

    async getNearest(timestamp) {
      const beforeOrAt = await db.bodyweightLog
        .where("recordedAt")
        .belowOrEqual(timestamp)
        .filter((r) => r.deletedAt === null)
        .last();
      const after = await db.bodyweightLog
        .where("recordedAt")
        .above(timestamp)
        .filter((r) => r.deletedAt === null)
        .first();

      if (!beforeOrAt) return after ?? null;
      if (!after) return beforeOrAt;

      const beforeDiff = timestamp - beforeOrAt.recordedAt;
      const afterDiff = after.recordedAt - timestamp;
      return beforeDiff <= afterDiff ? beforeOrAt : after;
    },

    async listRecent(limit) {
      return db.bodyweightLog
        .orderBy("recordedAt")
        .reverse()
        .filter((r) => r.deletedAt === null)
        .limit(limit)
        .toArray();
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
