import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { bumpSessionActivity } from "./sessionRepository.js";
import { validateWeightKg, validateReps, validateDurationSec, validateRpe, validateLoggedAt } from "../validation.js";
import type { GymDatabase } from "../db.js";
import type { SetRecord } from "../types.js";

export interface NewSet {
  sessionExerciseId: string;
  weightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  isWarmup?: boolean;
  completed?: boolean;
  targetReps?: number | null;
  note?: string | null;
  bodyweightKgAtTime: number;
  loggedAt: number;
}

export interface SetRepository {
  log(input: NewSet): Promise<SetRecord>;
  update(id: string, patch: Partial<NewSet>): Promise<SetRecord>;
  softDelete(id: string): Promise<void>;
  listBySessionExercise(sessionExerciseId: string): Promise<SetRecord[]>;
}

const ORDER_INDEX_STEP = 1000;

function validateSetFields(input: Partial<NewSet>): void {
  if (input.weightKg != null) validateWeightKg(input.weightKg);
  if (input.reps != null) validateReps(input.reps);
  if (input.durationSec != null) validateDurationSec(input.durationSec);
  if (input.rpe != null) validateRpe(input.rpe);
  if (input.loggedAt !== undefined) validateLoggedAt(input.loggedAt);
}

async function nextOrderIndex(db: GymDatabase, sessionExerciseId: string): Promise<number> {
  const active = (await db.sets.where("sessionExerciseId").equals(sessionExerciseId).toArray()).filter((r) => r.deletedAt === null);
  if (active.length === 0) return ORDER_INDEX_STEP;
  return Math.max(...active.map((r) => r.orderIndex)) + ORDER_INDEX_STEP;
}

// The most recent non-deleted set logged anywhere in the session (across
// every sessionExercise, not just this one) strictly before `beforeLoggedAt`
// — rest is time since whatever was lifted last, regardless of which
// exercise it was. `excludeSetId` keeps an update() from comparing a set
// against its own (stale) prior loggedAt.
async function findPreviousSetLoggedAt(
  db: GymDatabase,
  sessionId: string,
  beforeLoggedAt: number,
  excludeSetId?: string
): Promise<number | null> {
  const sessionExerciseIds = (await db.sessionExercises.where("sessionId").equals(sessionId).toArray()).map((se) => se.id);
  let latest: number | null = null;
  for (const sessionExerciseId of sessionExerciseIds) {
    const sets = await db.sets.where("sessionExerciseId").equals(sessionExerciseId).toArray();
    for (const s of sets) {
      if (s.id === excludeSetId) continue;
      if (s.deletedAt !== null || s.loggedAt >= beforeLoggedAt) continue;
      if (latest === null || s.loggedAt > latest) latest = s.loggedAt;
    }
  }
  return latest;
}

function restBeforeSecFrom(loggedAt: number, previousLoggedAt: number | null): number | null {
  return previousLoggedAt === null ? null : Math.round((loggedAt - previousLoggedAt) / 1000);
}

export function createSetRepository(db: GymDatabase): SetRepository {
  return {
    async log(input) {
      validateSetFields(input);
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sets, db.sessionExercises, db.sessions, db.syncQueue, async () => {
        const sessionExercise = await db.sessionExercises.get(input.sessionExerciseId);
        if (!sessionExercise || sessionExercise.deletedAt !== null) {
          throw new Error(`Cannot log a set — sessionExercise ${input.sessionExerciseId} does not exist or has been deleted.`);
        }

        const orderIndex = await nextOrderIndex(db, input.sessionExerciseId);
        const previousLoggedAt = await findPreviousSetLoggedAt(db, sessionExercise.sessionId, input.loggedAt);

        const record: SetRecord = {
          id: newId(),
          sessionExerciseId: input.sessionExerciseId,
          exerciseId: sessionExercise.exerciseId,
          orderIndex,
          weightKg: input.weightKg ?? null,
          reps: input.reps ?? null,
          durationSec: input.durationSec ?? null,
          distanceM: input.distanceM ?? null,
          rpe: input.rpe ?? null,
          isWarmup: input.isWarmup ?? false,
          completed: input.completed ?? true,
          targetReps: input.targetReps ?? null,
          note: input.note ?? null,
          bodyweightKgAtTime: input.bodyweightKgAtTime,
          loggedAt: input.loggedAt,
          restBeforeSec: restBeforeSecFrom(input.loggedAt, previousLoggedAt),
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
          serverUpdatedAt: null,
        };
        await db.sets.add(record);
        await bumpSessionActivity(db, sessionExercise.sessionId, input.loggedAt);
        await enqueueSync(db, "set", record.id, "upsert");
        return record;
      });
    },

    async update(id, patch) {
      validateSetFields(patch);
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sets, db.sessionExercises, db.sessions, db.syncQueue, async () => {
        const existing = await db.sets.get(id);
        if (!existing || existing.deletedAt !== null) {
          throw new Error(`Cannot update set ${id} — it does not exist or has been deleted.`);
        }

        let sessionExerciseId = existing.sessionExerciseId;
        let exerciseId = existing.exerciseId;
        let orderIndex = existing.orderIndex;

        const movedSessionExercise = patch.sessionExerciseId !== undefined && patch.sessionExerciseId !== existing.sessionExerciseId;
        if (movedSessionExercise) {
          const target = await db.sessionExercises.get(patch.sessionExerciseId!);
          if (!target || target.deletedAt !== null) {
            throw new Error(`Cannot move set ${id} — target sessionExercise does not exist or has been deleted.`);
          }
          sessionExerciseId = patch.sessionExerciseId!;
          exerciseId = target.exerciseId;
          orderIndex = await nextOrderIndex(db, sessionExerciseId);
        }

        let restBeforeSec = existing.restBeforeSec;
        if (patch.loggedAt !== undefined) {
          const sessionId = (await db.sessionExercises.get(sessionExerciseId))!.sessionId;
          const previousLoggedAt = await findPreviousSetLoggedAt(db, sessionId, patch.loggedAt, id);
          restBeforeSec = restBeforeSecFrom(patch.loggedAt, previousLoggedAt);
        }

        const updated: SetRecord = {
          ...existing,
          ...patch,
          sessionExerciseId,
          exerciseId,
          orderIndex,
          restBeforeSec,
          updatedAt: now(),
          deviceId,
          syncedAt: null,
        };
        await db.sets.put(updated);
        await enqueueSync(db, "set", id, "upsert");
        return updated;
      });
    },

    async softDelete(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sets, db.syncQueue, async () => {
        await db.sets.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "set", id, "upsert");
      });
    },

    async listBySessionExercise(sessionExerciseId) {
      const rows = (await db.sets.where("sessionExerciseId").equals(sessionExerciseId).toArray()).filter((r) => r.deletedAt === null);
      return rows.sort((a, b) => a.orderIndex - b.orderIndex);
    },
  };
}
