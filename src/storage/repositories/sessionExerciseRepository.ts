import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import type { GymDatabase } from "../db.js";
import type { SessionExerciseRecord } from "../types.js";

export interface NewSessionExercise {
  sessionId: string;
  exerciseId: string;
  supersetGroup?: string | null;
  note?: string | null;
  substitutedFromId?: string | null;
  plannedFromRoutineExerciseId?: string | null;
}

export interface SessionExerciseRepository {
  add(input: NewSessionExercise): Promise<SessionExerciseRecord>;
  getById(id: string): Promise<SessionExerciseRecord | null>;
  listBySession(sessionId: string): Promise<SessionExerciseRecord[]>;
  // Moves `id` to sit between `beforeId` and `afterId` (either may be null
  // for "start"/"end" of the list) using sparse-index averaging (§5.5);
  // renormalizes the whole session's ordering first if the gap has closed.
  reorder(id: string, beforeId: string | null, afterId: string | null): Promise<SessionExerciseRecord>;
  // Records a SWAP: changes which exercise this slot performs, stamping
  // substitutedFromId with whatever it replaced (§5.2).
  substitute(id: string, newExerciseId: string): Promise<SessionExerciseRecord>;
  softDelete(id: string): Promise<void>;
}

const ORDER_INDEX_STEP = 1000;
const MIN_GAP = 2; // below this, no integer exists strictly between two neighbors

async function nextOrderIndex(db: GymDatabase, sessionId: string): Promise<number> {
  const active = (await db.sessionExercises.where("sessionId").equals(sessionId).toArray()).filter((r) => r.deletedAt === null);
  if (active.length === 0) return ORDER_INDEX_STEP;
  return Math.max(...active.map((r) => r.orderIndex)) + ORDER_INDEX_STEP;
}

// Re-spaces every active sessionExercise in the session back to clean
// 1000-increments, preserving their relative order — called only when a
// reorder's gap has closed below MIN_GAP.
async function renormalize(db: GymDatabase, sessionId: string, deviceId: string): Promise<void> {
  const rows = (await db.sessionExercises.where("sessionId").equals(sessionId).toArray())
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  for (let i = 0; i < rows.length; i++) {
    const newIndex = (i + 1) * ORDER_INDEX_STEP;
    if (rows[i]!.orderIndex !== newIndex) {
      await db.sessionExercises.update(rows[i]!.id, { orderIndex: newIndex, updatedAt: now(), deviceId, syncedAt: null });
    }
  }
}

export function createSessionExerciseRepository(db: GymDatabase): SessionExerciseRepository {
  return {
    async add(input) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessionExercises, db.syncQueue, async () => {
        const orderIndex = await nextOrderIndex(db, input.sessionId);
        const record: SessionExerciseRecord = {
          id: newId(),
          sessionId: input.sessionId,
          exerciseId: input.exerciseId,
          orderIndex,
          supersetGroup: input.supersetGroup ?? null,
          note: input.note ?? null,
          substitutedFromId: input.substitutedFromId ?? null,
          plannedFromRoutineExerciseId: input.plannedFromRoutineExerciseId ?? null,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
          serverUpdatedAt: null,
        };
        await db.sessionExercises.add(record);
        await enqueueSync(db, "sessionExercise", record.id, "upsert");
        return record;
      });
    },

    async getById(id) {
      const record = await db.sessionExercises.get(id);
      return record && record.deletedAt === null ? record : null;
    },

    async listBySession(sessionId) {
      const rows = (await db.sessionExercises.where("sessionId").equals(sessionId).toArray()).filter((r) => r.deletedAt === null);
      return rows.sort((a, b) => a.orderIndex - b.orderIndex);
    },

    async reorder(id, beforeId, afterId) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessionExercises, db.syncQueue, async () => {
        const target = await db.sessionExercises.get(id);
        if (!target || target.deletedAt !== null) {
          throw new Error(`Cannot reorder sessionExercise ${id} — it does not exist or has been deleted.`);
        }

        async function computeBounds(): Promise<{ lowerBound: number; upperBound: number }> {
          const before = beforeId ? await db.sessionExercises.get(beforeId) : undefined;
          const after = afterId ? await db.sessionExercises.get(afterId) : undefined;
          const lowerBound = before ? before.orderIndex : 0;
          const upperBound = after ? after.orderIndex : lowerBound + ORDER_INDEX_STEP * 2;
          return { lowerBound, upperBound };
        }

        let { lowerBound, upperBound } = await computeBounds();
        if (upperBound - lowerBound < MIN_GAP) {
          await renormalize(db, target.sessionId, deviceId);
          ({ lowerBound, upperBound } = await computeBounds());
        }

        const orderIndex = Math.floor((lowerBound + upperBound) / 2);
        const updated: SessionExerciseRecord = { ...target, orderIndex, updatedAt: now(), deviceId, syncedAt: null };
        await db.sessionExercises.put(updated);
        await enqueueSync(db, "sessionExercise", id, "upsert");
        return updated;
      });
    },

    async substitute(id, newExerciseId) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessionExercises, db.syncQueue, async () => {
        const existing = await db.sessionExercises.get(id);
        if (!existing || existing.deletedAt !== null) {
          throw new Error(`Cannot substitute sessionExercise ${id} — it does not exist or has been deleted.`);
        }
        const updated: SessionExerciseRecord = {
          ...existing,
          exerciseId: newExerciseId,
          substitutedFromId: existing.exerciseId,
          updatedAt: now(),
          deviceId,
          syncedAt: null,
        };
        await db.sessionExercises.put(updated);
        await enqueueSync(db, "sessionExercise", id, "upsert");
        return updated;
      });
    },

    async softDelete(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessionExercises, db.syncQueue, async () => {
        await db.sessionExercises.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "sessionExercise", id, "upsert");
      });
    },
  };
}
