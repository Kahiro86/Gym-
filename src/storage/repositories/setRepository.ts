import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { bumpSessionActivity } from "./sessionRepository.js";
import { validateWeightKg, validateReps, validateDurationSec, validateRpe, validateLoggedAt } from "../validation.js";
import { toLoggedSet } from "../convert.js";
import { getExercise } from "../../domain/registry.js";
import { recordSetIntoHistory } from "../../domain/prs.js";
import { emptyExerciseHistory } from "../../domain/types.js";
import type { GymDatabase } from "../db.js";
import type { SessionRecord, SetRecord } from "../types.js";
import type { ExerciseHistory } from "../../domain/types.js";

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

// bestEverFor's return value: the same shape Layer 1 folds sets into
// (recordSetIntoHistory) — a repository just replays a set's own history
// back out of storage instead of tracking it forward.
export type PrSnapshot = ExerciseHistory;

export interface SetRepository {
  log(input: NewSet): Promise<SetRecord>;
  update(id: string, patch: Partial<NewSet>): Promise<SetRecord>;
  softDelete(id: string): Promise<void>;
  listBySessionExercise(sessionExerciseId: string): Promise<SetRecord[]>;

  // The critical query — powers progressive overload ("what did I lift
  // last time on this exercise"). Backed by the [exerciseId+loggedAt]
  // index; must stay well under the UI's per-keystroke budget. Excludes
  // warmups and failed (incomplete) attempts — neither represents what the
  // user can actually do next time.
  lastPerformance(exerciseId: string, beforeSessionId?: string): Promise<{ session: SessionRecord; sets: SetRecord[] } | null>;

  bestEverFor(exerciseId: string): Promise<PrSnapshot>;
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

    async lastPerformance(exerciseId, beforeSessionId) {
      // [exerciseId+loggedAt] bounds the range scan to just this exercise's
      // rows. No .filter() chained onto the Dexie query itself — that
      // forces per-row cursor gets instead of one bulk fetch, orders of
      // magnitude slower under fake-indexeddb. Filter in plain JS after.
      const rows = (
        await db.sets.where("[exerciseId+loggedAt]").between([exerciseId, -Infinity], [exerciseId, Infinity]).toArray()
      ).filter((s) => s.deletedAt === null && s.completed && !s.isWarmup);
      if (rows.length === 0) return null;

      // Sets no longer carry sessionId directly (§5.2) — resolve each
      // candidate's session via its sessionExercise.
      const sessionExerciseIds = [...new Set(rows.map((s) => s.sessionExerciseId))];
      const sessionExerciseRows = await Promise.all(sessionExerciseIds.map((id) => db.sessionExercises.get(id)));
      const sessionIdBySessionExerciseId = new Map<string, string>();
      for (const se of sessionExerciseRows) {
        if (se && se.deletedAt === null) sessionIdBySessionExerciseId.set(se.id, se.sessionId);
      }

      const eligible = rows
        .map((set) => ({ set, sessionId: sessionIdBySessionExerciseId.get(set.sessionExerciseId) }))
        .filter((e): e is { set: SetRecord; sessionId: string } => e.sessionId !== undefined && e.sessionId !== beforeSessionId);
      if (eligible.length === 0) return null;

      const latestSessionId = eligible.reduce((latest, e) => (e.set.loggedAt > latest.set.loggedAt ? e : latest)).sessionId;
      const session = await db.sessions.get(latestSessionId);
      if (!session || session.deletedAt !== null) return null;

      const sets = eligible
        .filter((e) => e.sessionId === latestSessionId)
        .map((e) => e.set)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      return { session, sets };
    },

    async bestEverFor(exerciseId) {
      const exercise = getExercise(exerciseId);
      if (!exercise) {
        throw new Error(`Unknown exercise id: ${exerciseId}`);
      }

      // Same note as lastPerformance above — filter in JS, not Dexie.
      // Warmups and failed attempts never count toward a PR.
      const rows = (
        await db.sets.where("[exerciseId+loggedAt]").between([exerciseId, -Infinity], [exerciseId, Infinity]).toArray()
      ).filter((s) => s.deletedAt === null && s.completed && !s.isWarmup);

      let history: ExerciseHistory | undefined;
      for (const row of rows) {
        history = recordSetIntoHistory(exercise, toLoggedSet(row), history);
      }
      return history ?? emptyExerciseHistory();
    },
  };
}
