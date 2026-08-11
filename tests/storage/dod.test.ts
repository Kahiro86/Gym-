import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createExerciseRepository } from "../../src/storage/repositories/exerciseRepository.js";

// Spec §14, Definition of Done — the two guarantees that don't map onto
// any single task's own test file, so they get their own dedicated
// end-to-end coverage here.

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("DoD: no exercise deletion can orphan a set", () => {
  it("a set logged against a hidden custom exercise still resolves its exercise details", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const exercises = createExerciseRepository(db);

    const custom = await exercises.createCustom({
      name: "Garage Landmine Press",
      loadType: "barbell",
      primaryGroup: "shoulders",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
      equipment: ["barbell"],
      defaultRestSeconds: 90,
    });

    const session = await sessions.create({ startedAt: 1000 });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: custom.id });
    const set = await sets.log({ sessionExerciseId: se.id, weightKg: 40, reps: 8, bodyweightKgAtTime: 80, loggedAt: 1000 });

    await exercises.hide(custom.id);

    // The set itself is untouched.
    const persisted = await sets.listBySessionExercise(se.id);
    expect(persisted.map((s) => s.id)).toEqual([set.id]);
    expect(persisted[0]!.exerciseId).toBe(custom.id);

    // Its exercise still resolves — hiding removed it from search only.
    const resolved = await exercises.getById(custom.id);
    expect(resolved?.name).toBe("Garage Landmine Press");
    expect(await exercises.search("Garage Landmine Press", 10)).toEqual([]);
    db.close();
  });

  it("a set logged against a built-in later removed from the catalog still resolves via bestEverFor", async () => {
    const db = new GymDatabase(uniqueDbName());
    const deviceId = await db.getDeviceId();
    // Simulate a built-in that shipped once and was later dropped from
    // the catalog source, but the user has real history against it.
    await db.exercises.add({
      id: "discontinued-machine-row",
      name: "Discontinued Machine Row",
      aliases: [],
      loadType: "machine",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [],
      equipment: ["machine"],
      referenceVolume: 400,
      defaultRestSeconds: 90,
      isCustom: false,
      userModifiedFields: [],
      updatedAt: Date.now(),
      deletedAt: null,
      deviceId,
      syncedAt: null,
      serverUpdatedAt: null,
    });

    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const session = await sessions.create({ startedAt: 1000 });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: "discontinued-machine-row" });
    await sets.log({ sessionExerciseId: se.id, weightKg: 50, reps: 8, bodyweightKgAtTime: 80, loggedAt: 1000 });

    const { seedCatalog } = await import("../../src/storage/seed.js");
    const seedResult = await seedCatalog(db); // the catalog no longer lists this exercise
    expect(seedResult.removed).toBe(0); // never soft-deleted — it has history

    const row = await db.exercises.get("discontinued-machine-row");
    expect(row?.deletedAt).toBeNull();
    db.close();
  });
});

describe("DoD: a killed app mid-session resumes with all logged sets intact", () => {
  it("sets logged before a simulated crash survive, with no separate autosave needed", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    const sessions1 = createSessionRepository(db1);
    const sessionExercises1 = createSessionExerciseRepository(db1);
    const sets1 = createSetRepository(db1);

    // checkForActiveSession() compares lastActivityAt against real
    // wall-clock time, so "recent" here has to mean actually-recent —
    // unlike most of this suite, which uses small synthetic timestamps.
    const startedAt = Date.now() - 5 * 60_000;
    const session = await sessions1.create({ startedAt });
    const se = await sessionExercises1.add({ sessionId: session.id, exerciseId: "barbell-bench-press" });
    await sets1.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: startedAt });
    const lastSet = await sets1.log({ sessionExerciseId: se.id, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: startedAt + 100_000 });

    // No finish(), no explicit "save" of any kind — just close the
    // connection, simulating the app process dying mid-workout.
    db1.close();

    // A fresh connection, as if the app were relaunched.
    const db2 = new GymDatabase(name);
    const sessions2 = createSessionRepository(db2);
    const sets2 = createSetRepository(db2);

    const check = await sessions2.checkForActiveSession();
    expect(check).not.toBeNull();
    expect(check!.session.id).toBe(session.id);
    expect(check!.isStale).toBe(false); // recent activity, well under 6h
    // lastActivityAt was bumped by the second set's own write — this IS
    // the autosave, no separate mechanism needed.
    expect(check!.session.lastActivityAt).toBe(lastSet.loggedAt);

    const survivingSets = await sets2.listBySessionExercise(se.id);
    expect(survivingSets.map((s) => ({ weightKg: s.weightKg, reps: s.reps }))).toEqual([
      { weightKg: 60, reps: 5 },
      { weightKg: 65, reps: 5 },
    ]);
    db2.close();
  });

  it("a session abandoned for longer than the staleness threshold is still fully recoverable, just flagged", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    const sessions1 = createSessionRepository(db1);
    const sessionExercises1 = createSessionExerciseRepository(db1);
    const sets1 = createSetRepository(db1);

    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
    const session = await sessions1.create({ startedAt: sevenHoursAgo });
    const se = await sessionExercises1.add({ sessionId: session.id, exerciseId: "back-squat" });
    await sets1.log({ sessionExerciseId: se.id, weightKg: 100, reps: 5, bodyweightKgAtTime: 80, loggedAt: sevenHoursAgo });
    db1.close();

    const db2 = new GymDatabase(name);
    const sessions2 = createSessionRepository(db2);
    const sets2 = createSetRepository(db2);

    const check = await sessions2.checkForActiveSession();
    expect(check!.isStale).toBe(true);
    expect(check!.session.state).toBe("abandoned");

    // Still resumable, and the set is still there either way.
    const resumed = await sessions2.resume(session.id);
    expect(resumed.state).toBe("in_progress");
    const survivingSets = await sets2.listBySessionExercise(se.id);
    expect(survivingSets.length).toBe(1);
    db2.close();
  });
});
