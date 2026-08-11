import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createRoutineRepository, createRoutineExerciseRepository, comparePlanVsPerformed } from "../../src/storage/repositories/routineRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";
const SQUAT = "back-squat";

describe("RoutineRepository", () => {
  it("create() writes a durable routine and enqueues sync", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createRoutineRepository(db);
    const routine = await repo.create({ name: "Push Day" });
    expect(await db.routines.get(routine.id)).toBeDefined();
    expect(await db.syncQueue.where("entityType").equals("routine").count()).toBe(1);
    db.close();
  });

  it("getById returns null for a nonexistent or deleted routine", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createRoutineRepository(db);
    expect(await repo.getById("nope")).toBeNull();
    const routine = await repo.create({ name: "Push Day" });
    await repo.softDelete(routine.id);
    expect(await repo.getById(routine.id)).toBeNull();
    db.close();
  });

  it("list() excludes soft-deleted routines, sorted by name", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createRoutineRepository(db);
    await repo.create({ name: "Push Day" });
    const legs = await repo.create({ name: "Leg Day" });
    await repo.create({ name: "Pull Day" });
    await repo.softDelete(legs.id);

    const list = await repo.list();
    expect(list.map((r) => r.name)).toEqual(["Pull Day", "Push Day"]);
    db.close();
  });

  it("update() patches fields and stamps sync columns", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createRoutineRepository(db);
    const routine = await repo.create({ name: "Push Day" });
    const updated = await repo.update(routine.id, { note: "3x/week" });
    expect(updated.note).toBe("3x/week");
    expect(updated.name).toBe("Push Day"); // untouched
    db.close();
  });
});

describe("RoutineExerciseRepository", () => {
  it("add() assigns sparse orderIndex per routine", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routines = createRoutineRepository(db);
    const routineExercises = createRoutineExerciseRepository(db);
    const routine = await routines.create({ name: "Push Day" });

    const a = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });
    const b = await routineExercises.add({ routineId: routine.id, exerciseId: SQUAT });
    expect(a.orderIndex).toBe(1000);
    expect(b.orderIndex).toBe(2000);
    db.close();
  });

  it("add() defaults optional prescription fields to null", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routines = createRoutineRepository(db);
    const routineExercises = createRoutineExerciseRepository(db);
    const routine = await routines.create({ name: "Push Day" });
    const re = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });
    expect(re.targetSets).toBeNull();
    expect(re.targetReps).toBeNull();
    expect(re.targetWeightKg).toBeNull();
    db.close();
  });

  it("listByRoutine excludes other routines and soft-deleted entries, ordered", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routines = createRoutineRepository(db);
    const routineExercises = createRoutineExerciseRepository(db);
    const routine = await routines.create({ name: "Push Day" });
    const other = await routines.create({ name: "Leg Day" });

    const a = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });
    const b = await routineExercises.add({ routineId: routine.id, exerciseId: SQUAT });
    const deleted = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });
    await routineExercises.add({ routineId: other.id, exerciseId: BENCH });
    await routineExercises.softDelete(deleted.id);

    const list = await routineExercises.listByRoutine(routine.id);
    expect(list.map((r) => r.id)).toEqual([a.id, b.id]);
    db.close();
  });

  it("reorder() places an entry between two neighbors", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routines = createRoutineRepository(db);
    const routineExercises = createRoutineExerciseRepository(db);
    const routine = await routines.create({ name: "Push Day" });
    const a = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });
    const b = await routineExercises.add({ routineId: routine.id, exerciseId: SQUAT });
    const c = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });

    await routineExercises.reorder(c.id, a.id, b.id);
    const list = await routineExercises.listByRoutine(routine.id);
    expect(list.map((r) => r.id)).toEqual([a.id, c.id, b.id]);
    db.close();
  });

  it("update() patches prescription fields", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routines = createRoutineRepository(db);
    const routineExercises = createRoutineExerciseRepository(db);
    const routine = await routines.create({ name: "Push Day" });
    const re = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH });
    const updated = await routineExercises.update(re.id, { targetSets: 3, targetReps: 8 });
    expect(updated.targetSets).toBe(3);
    expect(updated.targetReps).toBe(8);
    db.close();
  });
});

describe("comparePlanVsPerformed", () => {
  it("pairs a routine's prescription with what was actually completed", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routines = createRoutineRepository(db);
    const routineExercises = createRoutineExerciseRepository(db);
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    const routine = await routines.create({ name: "Push Day" });
    const prescription = await routineExercises.add({ routineId: routine.id, exerciseId: BENCH, targetSets: 3, targetReps: 8 });

    const session = await sessions.create({ startedAt: 1000, routineId: routine.id });
    const se = await sessionExercises.add({
      sessionId: session.id,
      exerciseId: BENCH,
      plannedFromRoutineExerciseId: prescription.id,
    });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 8, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 7, bodyweightKgAtTime: 80, loggedAt: 1100 });
    // A warmup and a failed attempt — neither should count as "performed".
    await sets.log({ sessionExerciseId: se.id, weightKg: 20, reps: 10, bodyweightKgAtTime: 80, loggedAt: 900, isWarmup: true });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 2, bodyweightKgAtTime: 80, loggedAt: 1200, completed: false });

    const comparison = await comparePlanVsPerformed(db, session.id);
    expect(comparison.routineId).toBe(routine.id);
    expect(comparison.exercises).toHaveLength(1);
    expect(comparison.exercises[0]!.planned).toEqual({ targetSets: 3, targetReps: 8, targetWeightKg: null });
    expect(comparison.exercises[0]!.performedSets).toEqual([
      { weightKg: 60, reps: 8 },
      { weightKg: 60, reps: 7 },
    ]);
    db.close();
  });

  it("reports planned: null for a session exercise not linked to any routine prescription", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);

    const session = await sessions.create({ startedAt: 1000 });
    await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });

    const comparison = await comparePlanVsPerformed(db, session.id);
    expect(comparison.routineId).toBeNull();
    expect(comparison.exercises[0]!.planned).toBeNull();
    db.close();
  });

  it("throws for a nonexistent or deleted session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await expect(comparePlanVsPerformed(db, "nope")).rejects.toThrow();

    const sessions = createSessionRepository(db);
    const session = await sessions.create({ startedAt: 1000 });
    await sessions.softDelete(session.id);
    await expect(comparePlanVsPerformed(db, session.id)).rejects.toThrow();
    db.close();
  });
});
