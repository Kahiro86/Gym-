import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import type { GymDatabase } from "../db.js";
import type { RoutineExerciseRecord, RoutineRecord } from "../types.js";

export interface NewRoutine {
  name: string;
  note?: string | null;
}

export interface RoutineRepository {
  create(input: NewRoutine): Promise<RoutineRecord>;
  getById(id: string): Promise<RoutineRecord | null>;
  list(): Promise<RoutineRecord[]>;
  update(id: string, patch: Partial<NewRoutine>): Promise<RoutineRecord>;
  softDelete(id: string): Promise<void>;
}

export function createRoutineRepository(db: GymDatabase): RoutineRepository {
  return {
    async create(input) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routines, db.syncQueue, async () => {
        const record: RoutineRecord = {
          id: newId(),
          name: input.name,
          note: input.note ?? null,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
          serverUpdatedAt: null,
        };
        await db.routines.add(record);
        await enqueueSync(db, "routine", record.id, "upsert");
        return record;
      });
    },

    async getById(id) {
      const record = await db.routines.get(id);
      return record && record.deletedAt === null ? record : null;
    },

    async list() {
      const rows = await db.routines.toArray();
      return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name));
    },

    async update(id, patch) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routines, db.syncQueue, async () => {
        const existing = await db.routines.get(id);
        if (!existing || existing.deletedAt !== null) {
          throw new Error(`Cannot update routine ${id} — it does not exist or has been deleted.`);
        }
        const updated: RoutineRecord = { ...existing, ...patch, updatedAt: now(), deviceId, syncedAt: null };
        await db.routines.put(updated);
        await enqueueSync(db, "routine", id, "upsert");
        return updated;
      });
    },

    async softDelete(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routines, db.syncQueue, async () => {
        await db.routines.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "routine", id, "upsert");
      });
    },
  };
}

export interface NewRoutineExercise {
  routineId: string;
  exerciseId: string;
  supersetGroup?: string | null;
  targetSets?: number | null;
  targetReps?: number | null;
  targetWeightKg?: number | null;
  note?: string | null;
}

export interface RoutineExerciseRepository {
  add(input: NewRoutineExercise): Promise<RoutineExerciseRecord>;
  listByRoutine(routineId: string): Promise<RoutineExerciseRecord[]>;
  // Same sparse-index averaging as sessionExerciseRepository.reorder (§5.5).
  reorder(id: string, beforeId: string | null, afterId: string | null): Promise<RoutineExerciseRecord>;
  update(id: string, patch: Partial<NewRoutineExercise>): Promise<RoutineExerciseRecord>;
  softDelete(id: string): Promise<void>;
}

const ORDER_INDEX_STEP = 1000;
const MIN_GAP = 2;

async function nextOrderIndex(db: GymDatabase, routineId: string): Promise<number> {
  const active = (await db.routineExercises.where("routineId").equals(routineId).toArray()).filter((r) => r.deletedAt === null);
  if (active.length === 0) return ORDER_INDEX_STEP;
  return Math.max(...active.map((r) => r.orderIndex)) + ORDER_INDEX_STEP;
}

async function renormalize(db: GymDatabase, routineId: string, deviceId: string): Promise<void> {
  const rows = (await db.routineExercises.where("routineId").equals(routineId).toArray())
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  for (let i = 0; i < rows.length; i++) {
    const newIndex = (i + 1) * ORDER_INDEX_STEP;
    if (rows[i]!.orderIndex !== newIndex) {
      await db.routineExercises.update(rows[i]!.id, { orderIndex: newIndex, updatedAt: now(), deviceId, syncedAt: null });
    }
  }
}

export function createRoutineExerciseRepository(db: GymDatabase): RoutineExerciseRepository {
  return {
    async add(input) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routineExercises, db.syncQueue, async () => {
        const orderIndex = await nextOrderIndex(db, input.routineId);
        const record: RoutineExerciseRecord = {
          id: newId(),
          routineId: input.routineId,
          exerciseId: input.exerciseId,
          orderIndex,
          supersetGroup: input.supersetGroup ?? null,
          targetSets: input.targetSets ?? null,
          targetReps: input.targetReps ?? null,
          targetWeightKg: input.targetWeightKg ?? null,
          note: input.note ?? null,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
          serverUpdatedAt: null,
        };
        await db.routineExercises.add(record);
        await enqueueSync(db, "routineExercise", record.id, "upsert");
        return record;
      });
    },

    async listByRoutine(routineId) {
      const rows = (await db.routineExercises.where("routineId").equals(routineId).toArray()).filter((r) => r.deletedAt === null);
      return rows.sort((a, b) => a.orderIndex - b.orderIndex);
    },

    async reorder(id, beforeId, afterId) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routineExercises, db.syncQueue, async () => {
        const target = await db.routineExercises.get(id);
        if (!target || target.deletedAt !== null) {
          throw new Error(`Cannot reorder routineExercise ${id} — it does not exist or has been deleted.`);
        }

        async function computeBounds(): Promise<{ lowerBound: number; upperBound: number }> {
          const before = beforeId ? await db.routineExercises.get(beforeId) : undefined;
          const after = afterId ? await db.routineExercises.get(afterId) : undefined;
          const lowerBound = before ? before.orderIndex : 0;
          const upperBound = after ? after.orderIndex : lowerBound + ORDER_INDEX_STEP * 2;
          return { lowerBound, upperBound };
        }

        let { lowerBound, upperBound } = await computeBounds();
        if (upperBound - lowerBound < MIN_GAP) {
          await renormalize(db, target.routineId, deviceId);
          ({ lowerBound, upperBound } = await computeBounds());
        }

        const orderIndex = Math.floor((lowerBound + upperBound) / 2);
        const updated: RoutineExerciseRecord = { ...target, orderIndex, updatedAt: now(), deviceId, syncedAt: null };
        await db.routineExercises.put(updated);
        await enqueueSync(db, "routineExercise", id, "upsert");
        return updated;
      });
    },

    async update(id, patch) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routineExercises, db.syncQueue, async () => {
        const existing = await db.routineExercises.get(id);
        if (!existing || existing.deletedAt !== null) {
          throw new Error(`Cannot update routineExercise ${id} — it does not exist or has been deleted.`);
        }
        const updated: RoutineExerciseRecord = { ...existing, ...patch, updatedAt: now(), deviceId, syncedAt: null };
        await db.routineExercises.put(updated);
        await enqueueSync(db, "routineExercise", id, "upsert");
        return updated;
      });
    },

    async softDelete(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.routineExercises, db.syncQueue, async () => {
        await db.routineExercises.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "routineExercise", id, "upsert");
      });
    },
  };
}

export interface PlanVsPerformedExercise {
  sessionExerciseId: string;
  exerciseId: string;
  planned: { targetSets: number | null; targetReps: number | null; targetWeightKg: number | null } | null;
  performedSets: { weightKg: number | null; reps: number | null }[];
}

export interface PlanVsPerformedComparison {
  sessionId: string;
  routineId: string | null;
  exercises: PlanVsPerformedExercise[];
}

// The plan-vs-performed linkage (§5.2/§13): walks a session's exercises,
// resolves each one's prescription via sessionExercise.plannedFromRoutineExerciseId
// when it was logged against a routine, and pairs it with what was
// actually completed (excluding warmups and failed attempts, same as
// setRepository's queries — neither represents real performance).
export async function comparePlanVsPerformed(db: GymDatabase, sessionId: string): Promise<PlanVsPerformedComparison> {
  const session = await db.sessions.get(sessionId);
  if (!session || session.deletedAt !== null) {
    throw new Error(`Cannot compare plan vs performed for session ${sessionId} — it does not exist or has been deleted.`);
  }

  const sessionExerciseRows = (await db.sessionExercises.where("sessionId").equals(sessionId).toArray()).filter(
    (r) => r.deletedAt === null
  );

  const exercises: PlanVsPerformedExercise[] = [];
  for (const se of sessionExerciseRows) {
    const routineExercise = se.plannedFromRoutineExerciseId ? await db.routineExercises.get(se.plannedFromRoutineExerciseId) : undefined;
    const sets = (await db.sets.where("sessionExerciseId").equals(se.id).toArray()).filter(
      (s) => s.deletedAt === null && s.completed && !s.isWarmup
    );

    exercises.push({
      sessionExerciseId: se.id,
      exerciseId: se.exerciseId,
      planned:
        routineExercise && routineExercise.deletedAt === null
          ? { targetSets: routineExercise.targetSets, targetReps: routineExercise.targetReps, targetWeightKg: routineExercise.targetWeightKg }
          : null,
      performedSets: sets.sort((a, b) => a.orderIndex - b.orderIndex).map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
    });
  }

  return { sessionId, routineId: session.routineId, exercises };
}
