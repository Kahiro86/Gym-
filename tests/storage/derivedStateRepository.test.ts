import { describe, it, expect } from "vitest";
import { GymDatabase, ENGINE_VERSION } from "../../src/storage/db.js";
import { createDerivedStateRepository } from "../../src/storage/repositories/derivedStateRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { computeSessionXp } from "../../src/domain/xp.js";
import { MUSCLE_IDS } from "../../src/domain/muscles.js";
import { emptyExerciseHistory } from "../../src/domain/types.js";
import type { ExerciseHistory, BodyweightHistory, LoggedSet } from "../../src/domain/types.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";
const SQUAT = "back-squat";
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

async function setupSessionExercise(db: GymDatabase, exerciseId: string, startedAt: number) {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const session = await sessions.create({ startedAt });
  const se = await sessionExercises.add({ sessionId: session.id, exerciseId });
  return { session, sessionExercise: se };
}

async function finishSession(db: GymDatabase, sessionId: string, endedAt: number) {
  await createSessionRepository(db).finish(sessionId, endedAt);
}

describe("DerivedStateRepository", () => {
  it("rebuildDerivedState on an empty database zeroes every muscle and stores no PR rows", async () => {
    const db = new GymDatabase(uniqueDbName());
    const derived = createDerivedStateRepository(db);
    await derived.rebuildDerivedState();

    const allXp = await derived.getAllMuscleXp();
    expect(Object.values(allXp).every((xp) => xp === 0)).toBe(true);
    expect(await db.prCache.count()).toBe(0);
    db.close();
  });

  it("getPrSnapshot returns an empty history for an exercise never logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const derived = createDerivedStateRepository(db);
    await derived.rebuildDerivedState();
    expect(await derived.getPrSnapshot(BENCH)).toEqual(emptyExerciseHistory());
    db.close();
  });

  it("matches a direct computeSessionXp call for a single session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    const { sessionExercise } = await setupSessionExercise(db, BENCH, 0);
    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 100 });

    await derived.rebuildDerivedState();

    const loggedSets: LoggedSet[] = [
      { exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKg: 80, timestamp: 0 },
      { exerciseId: BENCH, weightKg: 65, reps: 5, bodyweightKg: 80, timestamp: 100 },
    ];
    const expected = computeSessionXp({ sets: loggedSets }, { exerciseHistory: {}, isFirstSessionOfDay: true, streakWeeks: 0 });

    expect(await derived.getAllMuscleXp()).toEqual(expected.muscleXp);
    db.close();
  });

  it("getPrSnapshot matches SetRepository.bestEverFor after a rebuild", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    const { sessionExercise } = await setupSessionExercise(db, SQUAT, 0);
    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 110, reps: 3, bodyweightKgAtTime: 80, loggedAt: 100 });

    await derived.rebuildDerivedState();
    expect(await derived.getPrSnapshot(SQUAT)).toEqual(await sets.bestEverFor(SQUAT));
    db.close();
  });

  it("excludes warmups and failed attempts from the replay", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);
    const { sessionExercise } = await setupSessionExercise(db, BENCH, 0);

    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 490, reps: 1, bodyweightKgAtTime: 80, loggedAt: 100, isWarmup: true });
    await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 480, reps: 1, bodyweightKgAtTime: 80, loggedAt: 200, completed: false });

    await derived.rebuildDerivedState();
    const snapshot = await derived.getPrSnapshot(BENCH);
    expect(snapshot.maxWeightKg).toBe(60);
    db.close();
  });

  it("excludes soft-deleted sets and soft-deleted sessions from the replay", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const sessions = createSessionRepository(db);
    const derived = createDerivedStateRepository(db);

    const { sessionExercise: se1 } = await setupSessionExercise(db, BENCH, 0);
    const deletedSet = await sets.log({ sessionExerciseId: se1.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.softDelete(deletedSet.id);
    await finishSession(db, se1.sessionId, 1000);

    const { session: session2, sessionExercise: se2 } = await setupSessionExercise(db, SQUAT, 2000);
    await sets.log({ sessionExerciseId: se2.id, weightKg: 80, reps: 5, bodyweightKgAtTime: 80, loggedAt: 2000 });
    await sessions.softDelete(session2.id);

    await derived.rebuildDerivedState();
    const allXp = await derived.getAllMuscleXp();
    expect(Object.values(allXp).every((xp) => xp === 0)).toBe(true);
    expect(await derived.getPrSnapshot(BENCH)).toEqual(emptyExerciseHistory());
    expect(await derived.getPrSnapshot(SQUAT)).toEqual(emptyExerciseHistory());
    db.close();
  });

  it("computes isFirstSessionOfDay and streakWeeks from each session's own tzOffsetMinutes, matching a manual replay", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const derived = createDerivedStateRepository(db);

    // Session A: day 0. Session B: same day, a few hours later. Session C:
    // 8 days after A — a new day, and a new week following one full
    // trained week, so it should carry a 1-week streak. All UTC (offset 0)
    // for straightforward day/week bucket arithmetic.
    const a = await sessions.create({ startedAt: 0 });
    const seA = await sessionExercises.add({ sessionId: a.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: seA.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await finishSession(db, a.id, 100);

    const b = await sessions.create({ startedAt: 3 * 60 * 60 * 1000 });
    const seB = await sessionExercises.add({ sessionId: b.id, exerciseId: SQUAT });
    await sets.log({ sessionExerciseId: seB.id, weightKg: 80, reps: 5, bodyweightKgAtTime: 80, loggedAt: 3 * 60 * 60 * 1000 });
    await finishSession(db, b.id, 3 * 60 * 60 * 1000 + 100);

    const c = await sessions.create({ startedAt: 8 * DAY });
    const seC = await sessionExercises.add({ sessionId: c.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: seC.id, weightKg: 70, reps: 5, bodyweightKgAtTime: 80, loggedAt: 8 * DAY });
    await finishSession(db, c.id, 8 * DAY + 100);

    await derived.rebuildDerivedState();
    const actual = await derived.getAllMuscleXp();

    let exerciseHistory: Record<string, ExerciseHistory> = {};
    let bodyweightHistory: BodyweightHistory | undefined;
    const expected = Object.fromEntries(MUSCLE_IDS.map((m) => [m, 0])) as Record<string, number>;

    const sessionsInput = [
      { sets: [{ exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKg: 80, timestamp: 0 }], isFirstSessionOfDay: true, streakWeeks: 0 },
      {
        sets: [{ exerciseId: SQUAT, weightKg: 80, reps: 5, bodyweightKg: 80, timestamp: 3 * 60 * 60 * 1000 }],
        isFirstSessionOfDay: false,
        streakWeeks: 0,
      },
      { sets: [{ exerciseId: BENCH, weightKg: 70, reps: 5, bodyweightKg: 80, timestamp: 8 * DAY }], isFirstSessionOfDay: true, streakWeeks: 1 },
    ];
    for (const s of sessionsInput) {
      const result = computeSessionXp(
        { sets: s.sets },
        { exerciseHistory, bodyweightHistory, isFirstSessionOfDay: s.isFirstSessionOfDay, streakWeeks: s.streakWeeks }
      );
      exerciseHistory = result.updatedExerciseHistory;
      bodyweightHistory = result.updatedBodyweightHistory;
      for (const m of MUSCLE_IDS) expected[m]! += result.muscleXp[m];
    }

    expect(actual).toEqual(expected);
    db.close();
  });

  it("rebuild after a wipe reproduces byte-identical caches (12-week history)", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const derived = createDerivedStateRepository(db);
    const exercises = [BENCH, SQUAT];

    for (let week = 0; week < 12; week++) {
      for (let day = 0; day < 3; day++) {
        const startedAt = week * WEEK + day * 2 * DAY;
        const session = await sessions.create({ startedAt });
        for (let exIdx = 0; exIdx < 2; exIdx++) {
          const se = await sessionExercises.add({ sessionId: session.id, exerciseId: exercises[(week + day + exIdx) % exercises.length]! });
          for (let setIdx = 0; setIdx < 4; setIdx++) {
            await sets.log({
              sessionExerciseId: se.id,
              weightKg: 60 + week,
              reps: 5,
              bodyweightKgAtTime: 80,
              loggedAt: startedAt + exIdx * 300 + setIdx * 60,
            });
          }
        }
        await finishSession(db, session.id, startedAt + 3600);
      }
    }

    await derived.rebuildDerivedState();
    const snapshotXp = await derived.getAllMuscleXp();
    const snapshotBench = await derived.getPrSnapshot(BENCH);
    const snapshotSquat = await derived.getPrSnapshot(SQUAT);

    await db.muscleXpCache.clear();
    await db.prCache.clear();
    await derived.rebuildDerivedState();

    expect(await derived.getAllMuscleXp()).toEqual(snapshotXp);
    expect(await derived.getPrSnapshot(BENCH)).toEqual(snapshotBench);
    expect(await derived.getPrSnapshot(SQUAT)).toEqual(snapshotSquat);
    db.close();
  });

  describe("chunked rebuild progress", () => {
    it("reports progress in chunks up to the total session count", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const sessions = createSessionRepository(db);
      const sessionExercises = createSessionExerciseRepository(db);
      const derived = createDerivedStateRepository(db);

      const sessionCount = 120; // > CHUNK_SIZE (50), so multiple progress calls expected
      for (let i = 0; i < sessionCount; i++) {
        const session = await sessions.create({ startedAt: i * DAY });
        const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
        await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: i * DAY });
        await finishSession(db, session.id, i * DAY + 100);
      }

      const progressCalls: number[] = [];
      await derived.rebuildDerivedState((progress) => {
        expect(progress.totalSessions).toBe(sessionCount);
        progressCalls.push(progress.processedSessions);
      });

      expect(progressCalls.length).toBeGreaterThan(1);
      expect(progressCalls[progressCalls.length - 1]).toBe(sessionCount);
      expect(progressCalls).toEqual([...progressCalls].sort((a, b) => a - b)); // monotonically increasing
    });
  });

  describe("ensureFresh", () => {
    it("builds the cache on first call when it has never been built", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      const { sessionExercise } = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });

      expect(await db.muscleXpCache.count()).toBe(0);
      await derived.ensureFresh();
      expect(await db.muscleXpCache.count()).toBe(MUSCLE_IDS.length);
      db.close();
    });

    it("does not rebuild when the cache is already at the current engine version", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      const { sessionExercise } = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await derived.ensureFresh();
      const before = await derived.getAllMuscleXp();

      await finishSession(db, sessionExercise.sessionId, 100);
      const { sessionExercise: se2 } = await setupSessionExercise(db, SQUAT, 1000);
      await sets.log({ sessionExerciseId: se2.id, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await derived.ensureFresh();

      expect(await derived.getAllMuscleXp()).toEqual(before);
      db.close();
    });

    it("rebuilds when the cache was built under a stale engine version", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      const { sessionExercise } = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await derived.ensureFresh();

      await db.muscleXpCache.toCollection().modify({ engineVersion: ENGINE_VERSION - 1 });
      await finishSession(db, sessionExercise.sessionId, 100);
      const { sessionExercise: se2 } = await setupSessionExercise(db, SQUAT, 1000);
      await sets.log({ sessionExerciseId: se2.id, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await derived.ensureFresh();

      const rows = await db.muscleXpCache.toArray();
      expect(rows.every((r) => r.engineVersion === ENGINE_VERSION)).toBe(true);
      const squatSnapshot = await derived.getPrSnapshot(SQUAT);
      expect(squatSnapshot.maxWeightKg).toBe(100);
      db.close();
    });
  });

  describe("getHistoryContextForSession", () => {
    it("returns an empty history and isFirstSessionOfDay: true for the very first session ever", async () => {
      const db = new GymDatabase(uniqueDbName());
      const derived = createDerivedStateRepository(db);
      const { session } = await setupSessionExercise(db, BENCH, 0);

      const context = await derived.getHistoryContextForSession(session.id);
      expect(context).toEqual({ exerciseHistory: {}, bodyweightHistory: undefined, isFirstSessionOfDay: true, streakWeeks: 0 });
      db.close();
    });

    it("reflects prior sessions' sets, matching a manual replay via computeSessionXp", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);

      const { sessionExercise: se1 } = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: se1.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await finishSession(db, se1.sessionId, 100);

      const { session: session2 } = await setupSessionExercise(db, BENCH, 3 * 60 * 60 * 1000);

      const context = await derived.getHistoryContextForSession(session2.id);
      const expected = computeSessionXp(
        { sets: [{ exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKg: 80, timestamp: 0 }] },
        { exerciseHistory: {}, isFirstSessionOfDay: true, streakWeeks: 0 }
      );

      expect(context.exerciseHistory[BENCH]).toEqual(expected.updatedExerciseHistory[BENCH]);
      expect(context.isFirstSessionOfDay).toBe(false); // same day as session1
      db.close();
    });

    it("key-absence (not an empty-stats row) signals an exercise never logged before, matching HistoryContext's contract", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);

      const { sessionExercise: se1 } = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: se1.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await finishSession(db, se1.sessionId, 100);

      const { session: session2 } = await setupSessionExercise(db, SQUAT, 1000);
      const context = await derived.getHistoryContextForSession(session2.id);

      expect(BENCH in context.exerciseHistory).toBe(true);
      expect(SQUAT in context.exerciseHistory).toBe(false);
      db.close();
    });

    it("computes streakWeeks matching a manual replay for a session several weeks into a streak", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);

      const a = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: a.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await finishSession(db, a.session.id, 100);

      const { session: sessionC } = await setupSessionExercise(db, BENCH, 8 * DAY);
      const context = await derived.getHistoryContextForSession(sessionC.id);

      expect(context.isFirstSessionOfDay).toBe(true);
      expect(context.streakWeeks).toBe(1);
      db.close();
    });

    it("throws for a session that does not exist", async () => {
      const db = new GymDatabase(uniqueDbName());
      const derived = createDerivedStateRepository(db);
      await expect(derived.getHistoryContextForSession("does-not-exist")).rejects.toThrow();
      db.close();
    });

    it("throws for a soft-deleted session", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sessions = createSessionRepository(db);
      const derived = createDerivedStateRepository(db);
      const { session } = await setupSessionExercise(db, BENCH, 0);
      await sessions.softDelete(session.id);
      await expect(derived.getHistoryContextForSession(session.id)).rejects.toThrow();
      db.close();
    });
  });

  describe("getCurrentStreakWeeks", () => {
    it("is 0 for an empty database", async () => {
      const db = new GymDatabase(uniqueDbName());
      const derived = createDerivedStateRepository(db);
      expect(await derived.getCurrentStreakWeeks(0)).toBe(0);
      db.close();
    });

    it("counts the current week once it's been trained", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      const { session, sessionExercise } = await setupSessionExercise(db, BENCH, 0);
      await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await finishSession(db, session.id, 100);

      expect(await derived.getCurrentStreakWeeks(0)).toBe(1);
      db.close();
    });

    it("doesn't require the current week to already be trained — a streak survives up to the moment it would be broken", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      const { session, sessionExercise } = await setupSessionExercise(db, BENCH, -WEEK);
      await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: -WEEK });
      await finishSession(db, session.id, -WEEK + 100);

      // "now" (week 0) hasn't been trained yet, but last week was — the
      // streak going into this week is still 1, not reset to 0.
      expect(await derived.getCurrentStreakWeeks(0)).toBe(1);
      db.close();
    });

    it("counts consecutive trained weeks and stops at the first gap", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);

      // Trained this week and the two weeks before it...
      for (const weekOffset of [0, -1, -2]) {
        const startedAt = weekOffset * WEEK;
        const { session, sessionExercise } = await setupSessionExercise(db, BENCH, startedAt);
        await sets.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: startedAt });
        await finishSession(db, session.id, startedAt + 100);
      }
      // ...but not the week before that (a gap) — an even older session
      // must not reach across it and extend the streak.
      const gapCrossing = await setupSessionExercise(db, BENCH, -4 * WEEK);
      await sets.log({ sessionExerciseId: gapCrossing.sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: -4 * WEEK });
      await finishSession(db, gapCrossing.session.id, -4 * WEEK + 100);

      expect(await derived.getCurrentStreakWeeks(0)).toBe(3);
      db.close();
    });
  });
});
