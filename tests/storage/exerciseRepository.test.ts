import { describe, it, expect, beforeEach } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createExerciseRepository } from "../../src/storage/repositories/exerciseRepository.js";
import { seedCatalog } from "../../src/storage/seed.js";
import { createCompoundExercise, clearCompoundRegistry } from "../../src/domain/compound.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH_ID = "barbell-bench-press";
const SQUAT_ID = "back-squat";

beforeEach(() => {
  clearCompoundRegistry();
});

describe("ExerciseRepository", () => {
  describe("search", () => {
    it("ranks an exact name match above a substring match", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const results = await repo.search("Barbell Bench Press", 10);
      expect(results[0]?.id).toBe(BENCH_ID);
      db.close();
    });

    it("ranks a name-prefix match above an alias-prefix match", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      // "bench press" is an alias of barbell-bench-press but a name-prefix
      // of dumbbell-bench-press ("Dumbbell Bench Press").
      const results = await repo.search("Dumbbell Bench", 10);
      expect(results[0]?.name.toLowerCase()).toContain("dumbbell bench");
      db.close();
    });

    it("returns nothing for a query that matches no exercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const results = await repo.search("zzzznonexistentzzzz", 10);
      expect(results).toEqual([]);
      db.close();
    });

    it("respects the limit", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const results = await repo.search("press", 2);
      expect(results.length).toBeLessThanOrEqual(2);
      db.close();
    });

    it("includes runtime-registered compound exercises", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      createCompoundExercise("my-superset", "My Wild Superset", [BENCH_ID, SQUAT_ID]);

      const results = await repo.search("Wild Superset", 10);
      expect(results.map((e) => e.id)).toContain("my-superset");
      db.close();
    });

    it("includes newly created custom exercises", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      await repo.createCustom({
        name: "Garage Landmine Press",
        loadType: "barbell",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
        equipment: ["barbell"],
        referenceVolume: 100,
        defaultRestSeconds: 90,
      });

      const results = await repo.search("Landmine", 10);
      expect(results.map((e) => e.name)).toContain("Garage Landmine Press");
      db.close();
    });

    it("breaks equal-score ties by recent usage", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      // Both are exact-alias hits on "row" via different exercises whose
      // names don't start with "row" — force a recency-driven tiebreak by
      // logging a set against only one of them.
      await db.sets.add({
        id: "s1",
        sessionId: "sess",
        exerciseId: "barbell-row",
        orderIndex: 0,
        weightKg: 60,
        reps: 5,
        durationSec: null,
        distanceM: null,
        rpe: null,
        bodyweightKgAtTime: 80,
        loggedAt: 1000,
        updatedAt: Date.now(),
        deletedAt: null,
        deviceId: "d",
        syncedAt: null,
      });

      const results = await repo.search("row", 10);
      const barbellRowIndex = results.findIndex((e) => e.id === "barbell-row");
      const seatedCableRowIndex = results.findIndex((e) => e.id === "seated-cable-row");
      expect(barbellRowIndex).toBeGreaterThanOrEqual(0);
      expect(seatedCableRowIndex).toBeGreaterThanOrEqual(0);
      expect(barbellRowIndex).toBeLessThan(seatedCableRowIndex);
      db.close();
    });
  });

  describe("getById", () => {
    it("finds a seeded catalog exercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      expect((await repo.getById(BENCH_ID))?.id).toBe(BENCH_ID);
      db.close();
    });

    it("finds a custom exercise after creation", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Reverse Nordic Curl",
        loadType: "bodyweight",
        limbsLoaded: 1,
        unilateral: false,
        leverageFactor: 0.5,
        muscles: [{ muscle: "quads", share: 1, primaryMover: true }],
        equipment: ["bodyweight"],
        referenceVolume: 1500,
        defaultRestSeconds: 60,
      });

      expect((await repo.getById(created.id))?.name).toBe("Reverse Nordic Curl");
      db.close();
    });

    it("returns null for an unknown id", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      expect(await repo.getById("not-a-real-exercise")).toBeNull();
      db.close();
    });

    it("does not resolve a soft-deleted custom exercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Deleted Later",
        loadType: "machine",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "chestSternal", share: 1, primaryMover: true }],
        equipment: ["machine"],
        referenceVolume: 200,
        defaultRestSeconds: 90,
      });
      await db.exercises.update(created.id, { deletedAt: Date.now() });

      const db2 = new GymDatabase(db.name);
      const repo2 = createExerciseRepository(db2);
      expect(await repo2.getById(created.id)).toBeNull();
      db.close();
      db2.close();
    });
  });

  describe("createCustom", () => {
    it("writes a durable, isCustom record", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Cable Pull-Through",
        loadType: "cable",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "glutes", share: 1, primaryMover: true }],
        equipment: ["cable"],
        referenceVolume: 300,
        defaultRestSeconds: 90,
      });

      const stored = await db.exercises.get(created.id);
      expect(stored?.isCustom).toBe(true);
      expect(stored?.name).toBe("Cable Pull-Through");
      db.close();
    });

    it("enqueues a sync entry, unlike built-in catalog rows", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      await seedCatalog(db); // built-ins never enqueue
      const before = await db.syncQueue.where("entityType").equals("exercise").count();

      await repo.createCustom({
        name: "Sled Push",
        loadType: "distance",
        limbsLoaded: 1,
        unilateral: false,
        leverageFactor: 1,
        muscles: [{ muscle: "quads", share: 1, primaryMover: true }],
        equipment: ["none"],
        referenceVolume: 50,
        defaultRestSeconds: 120,
      });

      const after = await db.syncQueue.where("entityType").equals("exercise").count();
      expect(before).toBe(0);
      expect(after).toBe(1);
      db.close();
    });

    it("defaults aliases to an empty array when omitted", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Behind The Neck Press",
        loadType: "barbell",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "deltLateral", share: 1, primaryMover: true }],
        equipment: ["barbell"],
        referenceVolume: 150,
        defaultRestSeconds: 90,
      });
      expect(created.aliases).toEqual([]);
      db.close();
    });
  });
});
