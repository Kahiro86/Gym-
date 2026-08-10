import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { getExercise } from "../../domain/registry.js";
import { recordSetIntoHistory } from "../../domain/prs.js";
import { emptyExerciseHistory } from "../../domain/types.js";
import type { GymDatabase } from "../db.js";
import type { SessionRecord, SetRecord } from "../types.js";
import type { ExerciseHistory, LoggedSet } from "../../domain/types.js";

export interface NewSet {
  sessionId: string;
  exerciseId: string;
  weightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
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
  // Whole-session view, ordered chronologically by when each set was logged.
  // orderIndex (below) tracks position *within an exercise*, for reordering
  // that exercise's own set list — a separate concern from session order.
  listBySession(sessionId: string): Promise<SetRecord[]>;

  // The critical query — powers progressive overload ("what did I lift
  // last time on this exercise"). Backed by the [exerciseId+loggedAt]
  // index; must stay well under the UI's per-keystroke budget.
  lastPerformance(exerciseId: string, beforeSessionId?: string): Promise<{ session: SessionRecord; sets: SetRecord[] } | null>;

  bestEverFor(exerciseId: string): Promise<PrSnapshot>;
}

function toLoggedSet(record: SetRecord): LoggedSet {
  return {
    exerciseId: record.exerciseId,
    weightKg: record.weightKg ?? undefined,
    reps: record.reps ?? undefined,
    durationSec: record.durationSec ?? undefined,
    distanceM: record.distanceM ?? undefined,
    rpe: record.rpe ?? undefined,
    bodyweightKg: record.bodyweightKgAtTime,
    timestamp: record.loggedAt,
  };
}

// orderIndex is scoped to (sessionId, exerciseId): set 1, 2, 3 of *this*
// exercise in *this* session. Gaps left by soft deletes are never
// renumbered — display order only needs orderIndex to be monotonic, not
// contiguous.
async function nextOrderIndex(db: GymDatabase, sessionId: string, exerciseId: string): Promise<number> {
  const siblings = await db.sets
    .where("sessionId")
    .equals(sessionId)
    .filter((s) => s.exerciseId === exerciseId && s.deletedAt === null)
    .toArray();
  return siblings.reduce((max, s) => Math.max(max, s.orderIndex + 1), 0);
}

export function createSetRepository(db: GymDatabase): SetRepository {
  return {
    async log(input) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sets, db.syncQueue, async () => {
        const orderIndex = await nextOrderIndex(db, input.sessionId, input.exerciseId);
        const record: SetRecord = {
          id: newId(),
          sessionId: input.sessionId,
          exerciseId: input.exerciseId,
          orderIndex,
          weightKg: input.weightKg ?? null,
          reps: input.reps ?? null,
          durationSec: input.durationSec ?? null,
          distanceM: input.distanceM ?? null,
          rpe: input.rpe ?? null,
          bodyweightKgAtTime: input.bodyweightKgAtTime,
          loggedAt: input.loggedAt,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
        };
        await db.sets.add(record);
        await enqueueSync(db, "set", record.id, "upsert");
        return record;
      });
    },

    async update(id, patch) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sets, db.syncQueue, async () => {
        const existing = await db.sets.get(id);
        if (!existing || existing.deletedAt !== null) {
          throw new Error(`Cannot update set ${id} — it does not exist or has been deleted.`);
        }

        // Moving a set to a different exercise (or session) re-scopes its
        // orderIndex to the back of the new (sessionId, exerciseId) group,
        // exactly as if it had just been logged there.
        const movedExercise = patch.exerciseId !== undefined && patch.exerciseId !== existing.exerciseId;
        const movedSession = patch.sessionId !== undefined && patch.sessionId !== existing.sessionId;
        const nextSessionId = patch.sessionId ?? existing.sessionId;
        const nextExerciseId = patch.exerciseId ?? existing.exerciseId;
        const orderIndex =
          movedExercise || movedSession ? await nextOrderIndex(db, nextSessionId, nextExerciseId) : existing.orderIndex;

        const updated: SetRecord = {
          ...existing,
          ...patch,
          sessionId: nextSessionId,
          exerciseId: nextExerciseId,
          orderIndex,
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

    async listBySession(sessionId) {
      return db.sets
        .where("sessionId")
        .equals(sessionId)
        .filter((s) => s.deletedAt === null)
        .sortBy("loggedAt");
    },

    async lastPerformance(exerciseId, beforeSessionId) {
      // [exerciseId+loggedAt] bounds the range scan to just this exercise's
      // rows. Deliberately no .filter() chained onto the Dexie query itself
      // — that forces per-row cursor gets instead of one bulk fetch, which
      // is orders of magnitude slower than filtering the (already small,
      // index-bounded) result in plain JS afterward.
      const rows = (
        await db.sets.where("[exerciseId+loggedAt]").between([exerciseId, -Infinity], [exerciseId, Infinity]).toArray()
      ).filter((s) => s.deletedAt === null && s.sessionId !== beforeSessionId);
      if (rows.length === 0) return null;

      const latestSessionId = rows.reduce((latest, s) => (s.loggedAt > latest.loggedAt ? s : latest)).sessionId;
      const session = await db.sessions.get(latestSessionId);
      if (!session || session.deletedAt !== null) return null;

      const sets = rows.filter((s) => s.sessionId === latestSessionId).sort((a, b) => a.orderIndex - b.orderIndex);
      return { session, sets };
    },

    async bestEverFor(exerciseId) {
      const exercise = getExercise(exerciseId);
      if (!exercise) {
        throw new Error(`Unknown exercise id: ${exerciseId}`);
      }

      // See the note in lastPerformance() above — filter in JS, not Dexie.
      const rows = (
        await db.sets.where("[exerciseId+loggedAt]").between([exerciseId, -Infinity], [exerciseId, Infinity]).toArray()
      ).filter((s) => s.deletedAt === null);

      let history: ExerciseHistory | undefined;
      for (const row of rows) {
        history = recordSetIntoHistory(exercise, toLoggedSet(row), history);
      }
      return history ?? emptyExerciseHistory();
    },
  };
}
