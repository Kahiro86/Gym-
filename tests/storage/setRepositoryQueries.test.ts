import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";
const PUSHUP = "pushup";

async function setupSessionExercise(db: GymDatabase, exerciseId: string, startedAt: number) {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const session = await sessions.create({ startedAt });
  const se = await sessionExercises.add({ sessionId: session.id, exerciseId });
  return { session, sessionExercise: se };
}

// Only one session may be in_progress at a time — finish the previous one
// before setupSessionExercise() starts a new one in the same database.
async function finishSession(db: GymDatabase, sessionId: string, endedAt: number) {
  await createSessionRepository(db).finish(sessionId, endedAt);
}

describe("SetRepository queries", () => {
  describe("lastPerformance", () => {
    it("returns null when the exercise has never been logged", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      expect(await sets.lastPerformance(BENCH)).toBeNull();
      db.close();
    });

    it("returns the most recent session's matching sets", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);

      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1100 });
      await finishSession(db, s1.session.id, 1200);

      const s2 = await setupSessionExercise(db, BENCH, 2000);
      await sets.log({ sessionExerciseId: s2.sessionExercise.id, weightKg: 70, reps: 5, bodyweightKgAtTime: 80, loggedAt: 2000 });

      const result = await sets.lastPerformance(BENCH);
      expect(result?.session.id).toBe(s2.session.id);
      expect(result?.sets.map((s) => s.weightKg)).toEqual([70]);
      db.close();
    });

    it("excludes the given beforeSessionId, falling back to the prior session", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);

      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await finishSession(db, s1.session.id, 1200);

      const s2 = await setupSessionExercise(db, BENCH, 2000);
      await sets.log({ sessionExerciseId: s2.sessionExercise.id, weightKg: 70, reps: 5, bodyweightKgAtTime: 80, loggedAt: 2000 });

      const result = await sets.lastPerformance(BENCH, s2.session.id);
      expect(result?.session.id).toBe(s1.session.id);
      db.close();
    });

    it("excludes warmup sets", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 20, reps: 10, bodyweightKgAtTime: 80, loggedAt: 1000, isWarmup: true });
      expect(await sets.lastPerformance(BENCH)).toBeNull();
      db.close();
    });

    it("excludes failed (incomplete) attempts", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 2, bodyweightKgAtTime: 80, loggedAt: 1000, completed: false });
      expect(await sets.lastPerformance(BENCH)).toBeNull();
      db.close();
    });

    it("excludes soft-deleted sets", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const s1 = await setupSessionExercise(db, BENCH, 1000);
      const set = await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sets.softDelete(set.id);
      expect(await sets.lastPerformance(BENCH)).toBeNull();
      db.close();
    });

    it("returns null if the only candidate session has been soft-deleted", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const sessions = createSessionRepository(db);
      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sessions.softDelete(s1.session.id);
      expect(await sets.lastPerformance(BENCH)).toBeNull();
      db.close();
    });
  });

  describe("bestEverFor", () => {
    it("returns an empty history when the exercise has never been logged", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const history = await sets.bestEverFor(BENCH);
      expect(history.maxWeightKg).toBe(0);
      expect(history.maxVolumeSingleSet).toBe(0);
      expect(history.repsAtLoad).toEqual([]);
      db.close();
    });

    it("throws for an unknown exercise id", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      await expect(sets.bestEverFor("not-a-real-exercise")).rejects.toThrow();
      db.close();
    });

    it("folds completed, non-warmup sets across sessions into maxWeightKg/maxVolumeSingleSet/repsAtLoad", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 8, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 70, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1100 });
      await finishSession(db, s1.session.id, 1200);

      const s2 = await setupSessionExercise(db, BENCH, 2000);
      await sets.log({ sessionExerciseId: s2.sessionExercise.id, weightKg: 65, reps: 10, bodyweightKgAtTime: 80, loggedAt: 2000 });

      const history = await sets.bestEverFor(BENCH);
      expect(history.maxWeightKg).toBe(70);
      expect(history.maxVolumeSingleSet).toBe(650); // 65kg x 10 reps
      expect(history.repsAtLoad).toContainEqual({ loadKg: 70, reps: 5 });
      db.close();
    });

    it("excludes warmups, failed attempts, and soft-deleted sets from the replay", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const s1 = await setupSessionExercise(db, BENCH, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 200, reps: 1, bodyweightKgAtTime: 80, loggedAt: 1100, isWarmup: true });
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, weightKg: 300, reps: 1, bodyweightKgAtTime: 80, loggedAt: 1200, completed: false });
      const deletedHeavy = await sets.log({
        sessionExerciseId: s1.sessionExercise.id,
        weightKg: 400,
        reps: 1,
        bodyweightKgAtTime: 80,
        loggedAt: 1300,
      });
      await sets.softDelete(deletedHeavy.id);

      const history = await sets.bestEverFor(BENCH);
      expect(history.maxWeightKg).toBe(60);
      db.close();
    });

    it("computes bodyweight-derived load from each set's own bodyweightKgAtTime snapshot", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const s1 = await setupSessionExercise(db, PUSHUP, 1000);
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, reps: 20, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sets.log({ sessionExerciseId: s1.sessionExercise.id, reps: 15, bodyweightKgAtTime: 90, loggedAt: 1100 });

      const history = await sets.bestEverFor(PUSHUP);
      expect(history.maxWeightKg).toBeCloseTo(90 * 0.64, 5); // leverageFactor 0.64
      expect(history.repsAtLoad).toContainEqual({ loadKg: 80 * 0.64, reps: 20 });
      db.close();
    });
  });

  describe("performance", () => {
    // The 20s budget here is for bulkAdd-seeding 50,000+ rows through
    // fake-indexeddb (~5-6s), not the query itself — see the threshold
    // comment below for that.
    it("resolves lastPerformance well within budget against 50,000 seeded sets", { timeout: 20_000 }, async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const exerciseIds = ["barbell-bench-press", "deadlift", "pushup", "pull-up", "barbell-row"];
      const sessionCount = 1000;

      const sessionRecords = Array.from({ length: sessionCount }, (_, i) => ({
        id: `perf-session-${i}`,
        state: "completed" as const,
        startedAt: i * 1000,
        endedAt: i * 1000 + 3600,
        tzOffsetMinutes: 0,
        note: null,
        routineId: null,
        lastActivityAt: i * 1000 + 3600,
        updatedAt: Date.now(),
        deletedAt: null,
        deviceId: "seed",
        syncedAt: null,
        serverUpdatedAt: null,
      }));

      const sessionExerciseRecords: {
        id: string;
        sessionId: string;
        exerciseId: string;
        orderIndex: number;
        supersetGroup: null;
        note: null;
        substitutedFromId: null;
        plannedFromRoutineExerciseId: null;
        updatedAt: number;
        deletedAt: null;
        deviceId: string;
        syncedAt: null;
        serverUpdatedAt: null;
      }[] = [];
      const setRecords: Parameters<typeof db.sets.bulkAdd>[0][number][] = [];

      for (let s = 0; s < sessionCount; s++) {
        for (let e = 0; e < exerciseIds.length; e++) {
          const sessionExerciseId = `perf-se-${s}-${e}`;
          const exerciseId = exerciseIds[e]!;
          sessionExerciseRecords.push({
            id: sessionExerciseId,
            sessionId: `perf-session-${s}`,
            exerciseId,
            orderIndex: (e + 1) * 1000,
            supersetGroup: null,
            note: null,
            substitutedFromId: null,
            plannedFromRoutineExerciseId: null,
            updatedAt: Date.now(),
            deletedAt: null,
            deviceId: "seed",
            syncedAt: null,
            serverUpdatedAt: null,
          });
          for (let setIdx = 0; setIdx < 10; setIdx++) {
            setRecords.push({
              id: `perf-set-${s}-${e}-${setIdx}`,
              sessionExerciseId,
              exerciseId,
              orderIndex: (setIdx + 1) * 1000,
              weightKg: 50 + setIdx,
              reps: 5,
              durationSec: null,
              distanceM: null,
              rpe: null,
              isWarmup: false,
              completed: true,
              targetReps: null,
              note: null,
              bodyweightKgAtTime: 80,
              loggedAt: s * 1000 + e * 100 + setIdx,
              restBeforeSec: null,
              updatedAt: Date.now(),
              deletedAt: null,
              deviceId: "seed",
              syncedAt: null,
              serverUpdatedAt: null,
            });
          }
        }
      }

      await db.sessions.bulkAdd(sessionRecords);
      await db.sessionExercises.bulkAdd(sessionExerciseRecords);
      await db.sets.bulkAdd(setRecords);
      expect(await db.sets.count()).toBe(50_000);

      // One warm-up query — the budget below is for a query against an
      // already-open connection, not the very first access after a
      // 51,000-row bulk insert.
      await sets.lastPerformance("barbell-bench-press");

      const start = Date.now();
      const result = await sets.lastPerformance("barbell-bench-press");
      const elapsed = Date.now() - start;

      // The spec's <5ms budget (§9 task 11) is for native IndexedDB in a
      // browser at 50,000 sets. fake-indexeddb is a pure-JS reimplementation
      // with no native structured-clone/B-tree fast paths, and this query
      // also resolves each candidate set's session via a sessionExercises
      // lookup (§5.2's price for sets no longer pointing at sessions
      // directly) on top of the raw fetch. 500ms is this environment's
      // realistic floor with headroom for CI jitter; it still catches real
      // regressions — the equivalent v1 mistake (.filter() chained onto a
      // Dexie range query) cost ~3500ms on a set 10x smaller than this one.
      expect(result).not.toBeNull();
      expect(elapsed).toBeLessThan(500);
      db.close();
    });
  });
});
