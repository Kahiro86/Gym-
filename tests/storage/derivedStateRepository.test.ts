import { describe, it, expect } from "vitest";
import { GymDatabase, ENGINE_VERSION } from "../../src/storage/db.js";
import { createDerivedStateRepository } from "../../src/storage/repositories/derivedStateRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
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

async function addSession(db: GymDatabase, id: string, startedAt: number) {
  await db.sessions.add({
    id,
    startedAt,
    endedAt: startedAt + 3600,
    note: null,
    routineId: null,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId: "d",
    syncedAt: null,
  });
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

    await addSession(db, "s1", 0);
    await sets.log({ sessionId: "s1", exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.log({ sessionId: "s1", exerciseId: BENCH, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 100 });

    await derived.rebuildDerivedState();

    const loggedSets: LoggedSet[] = [
      { exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKg: 80, timestamp: 0 },
      { exerciseId: BENCH, weightKg: 65, reps: 5, bodyweightKg: 80, timestamp: 100 },
    ];
    const expected = computeSessionXp(
      { sets: loggedSets },
      { exerciseHistory: {}, isFirstSessionOfDay: true, streakWeeks: 0 }
    );

    expect(await derived.getAllMuscleXp()).toEqual(expected.muscleXp);
    db.close();
  });

  it("getPrSnapshot matches SetRepository.bestEverFor after a rebuild", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    await addSession(db, "s1", 0);
    await sets.log({ sessionId: "s1", exerciseId: SQUAT, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.log({ sessionId: "s1", exerciseId: SQUAT, weightKg: 110, reps: 3, bodyweightKgAtTime: 80, loggedAt: 100 });

    await derived.rebuildDerivedState();

    expect(await derived.getPrSnapshot(SQUAT)).toEqual(await sets.bestEverFor(SQUAT));
    db.close();
  });

  it("excludes soft-deleted sets and soft-deleted sessions from the replay", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    await addSession(db, "s1", 0);
    const deletedSet = await sets.log({ sessionId: "s1", exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sets.softDelete(deletedSet.id);

    await addSession(db, "s2", 1000);
    await sets.log({ sessionId: "s2", exerciseId: SQUAT, weightKg: 80, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await db.sessions.update("s2", { deletedAt: Date.now() });

    await derived.rebuildDerivedState();

    const allXp = await derived.getAllMuscleXp();
    expect(Object.values(allXp).every((xp) => xp === 0)).toBe(true);
    expect(await derived.getPrSnapshot(BENCH)).toEqual(emptyExerciseHistory());
    expect(await derived.getPrSnapshot(SQUAT)).toEqual(emptyExerciseHistory());
    db.close();
  });

  it("computes isFirstSessionOfDay and streakWeeks from session timestamps, matching a manual replay", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    // Session A: day 0. Session B: same day, a few hours later. Session C:
    // 8 days after A — a new day, and a new week following one full
    // trained week (A/B's week), so it should carry a 1-week streak.
    await addSession(db, "a", 0);
    await sets.log({ sessionId: "a", exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });

    await addSession(db, "b", 3 * 60 * 60 * 1000);
    await sets.log({ sessionId: "b", exerciseId: SQUAT, weightKg: 80, reps: 5, bodyweightKgAtTime: 80, loggedAt: 3 * 60 * 60 * 1000 });

    await addSession(db, "c", 8 * DAY);
    await sets.log({ sessionId: "c", exerciseId: BENCH, weightKg: 70, reps: 5, bodyweightKgAtTime: 80, loggedAt: 8 * DAY });

    await derived.rebuildDerivedState();
    const actual = await derived.getAllMuscleXp();

    // Manual replay mirroring the documented bucket algorithm exactly.
    let exerciseHistory: Record<string, ExerciseHistory> = {};
    let bodyweightHistory: BodyweightHistory | undefined;
    const expected = Object.fromEntries(MUSCLE_IDS.map((m) => [m, 0])) as Record<string, number>;

    const sessionsInput = [
      { sets: [{ exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKg: 80, timestamp: 0 }], isFirstSessionOfDay: true, streakWeeks: 0 },
      { sets: [{ exerciseId: SQUAT, weightKg: 80, reps: 5, bodyweightKg: 80, timestamp: 3 * 60 * 60 * 1000 }], isFirstSessionOfDay: false, streakWeeks: 0 },
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
    const derived = createDerivedStateRepository(db);
    const exercises = [BENCH, SQUAT];

    for (let week = 0; week < 12; week++) {
      for (let day = 0; day < 3; day++) {
        const sessionId = `w${week}d${day}`;
        const startedAt = week * WEEK + day * 2 * DAY;
        await addSession(db, sessionId, startedAt);
        for (let setIdx = 0; setIdx < 4; setIdx++) {
          const exerciseId = exercises[(week + day + setIdx) % exercises.length]!;
          await sets.log({
            sessionId,
            exerciseId,
            weightKg: 60 + week,
            reps: 5,
            bodyweightKgAtTime: 80,
            loggedAt: startedAt + setIdx * 60,
          });
        }
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

  describe("ensureFresh", () => {
    it("builds the cache on first call when it has never been built", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      await addSession(db, "s1", 0);
      await sets.log({ sessionId: "s1", exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });

      expect(await db.muscleXpCache.count()).toBe(0);
      await derived.ensureFresh();
      expect(await db.muscleXpCache.count()).toBe(MUSCLE_IDS.length);
      db.close();
    });

    it("does not rebuild when the cache is already at the current engine version", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      await addSession(db, "s1", 0);
      await sets.log({ sessionId: "s1", exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await derived.ensureFresh();
      const before = await derived.getAllMuscleXp();

      // Logged after the cache was built — a no-op ensureFresh() must not
      // pick this up (only an explicit rebuildDerivedState() should).
      await sets.log({ sessionId: "s1", exerciseId: SQUAT, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: 100 });
      await derived.ensureFresh();

      expect(await derived.getAllMuscleXp()).toEqual(before);
      db.close();
    });

    it("rebuilds when the cache was built under a stale engine version", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sets = createSetRepository(db);
      const derived = createDerivedStateRepository(db);
      await addSession(db, "s1", 0);
      await sets.log({ sessionId: "s1", exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
      await derived.ensureFresh();

      await db.muscleXpCache.toCollection().modify({ engineVersion: ENGINE_VERSION - 1 });
      await sets.log({ sessionId: "s1", exerciseId: SQUAT, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: 100 });
      await derived.ensureFresh();

      const rows = await db.muscleXpCache.toArray();
      expect(rows.every((r) => r.engineVersion === ENGINE_VERSION)).toBe(true);
      const snatSquat = await derived.getPrSnapshot(SQUAT);
      expect(snatSquat.maxWeightKg).toBe(100); // proves the post-stale-mark set was picked up
      db.close();
    });
  });
});
