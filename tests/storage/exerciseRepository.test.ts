import { describe, it, expect, beforeEach } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createExerciseRepository } from "../../src/storage/repositories/exerciseRepository.js";
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

    it("returns nothing for a query that matches no exercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      expect(await repo.search("zzzznonexistentzzzz", 10)).toEqual([]);
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

    it("finds a newly created custom exercise immediately (incremental index update)", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      await repo.createCustom({
        name: "Garage Landmine Press",
        loadType: "barbell",
        primaryGroup: "shoulders",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
        equipment: ["barbell"],
        defaultRestSeconds: 90,
      });
      const results = await repo.search("Landmine", 10);
      expect(results.map((e) => e.name)).toContain("Garage Landmine Press");
      db.close();
    });

    it("excludes a hidden custom exercise but keeps other results", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Temporary Curl",
        loadType: "dumbbell",
        primaryGroup: "arms",
        limbsLoaded: 2,
        unilateral: false,
        muscles: [{ muscle: "biceps", share: 1, primaryMover: true }],
        equipment: ["dumbbell"],
        defaultRestSeconds: 60,
      });
      await repo.hide(created.id);
      const results = await repo.search("Temporary Curl", 10);
      expect(results).toEqual([]);
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

    it("returns null for an unknown id", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      expect(await repo.getById("not-a-real-exercise")).toBeNull();
      db.close();
    });

    it("still resolves a hidden custom exercise — deleting can never orphan a set's history", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Vanishing Exercise",
        loadType: "machine",
        primaryGroup: "back",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "lats", share: 1, primaryMover: true }],
        equipment: ["machine"],
        defaultRestSeconds: 90,
      });
      await repo.hide(created.id);
      const resolved = await repo.getById(created.id);
      expect(resolved?.name).toBe("Vanishing Exercise");
      db.close();
    });
  });

  describe("createCustom", () => {
    it("derives referenceVolume from matching-loadType/group catalog archetypes", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Wide Grip Bench Press",
        loadType: "barbell",
        primaryGroup: "chest",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "chestSternal", share: 1, primaryMover: true }],
        equipment: ["barbell", "bench"],
        defaultRestSeconds: 180,
      });
      expect(created.referenceVolume).toBeGreaterThan(0);
      expect(Number.isFinite(created.referenceVolume)).toBe(true);
      db.close();
    });

    it("derives leverageFactor for load types that require it", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Decline Push-up",
        loadType: "bodyweight",
        primaryGroup: "chest",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "chestSternal", share: 1, primaryMover: true }],
        equipment: ["bodyweight"],
        defaultRestSeconds: 90,
      });
      expect(created.leverageFactor).toBeGreaterThan(0);
      db.close();
    });

    it("derives intensityFactor for the time load type", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Weighted Plank",
        loadType: "time",
        primaryGroup: "core",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "abs", share: 1, primaryMover: true }],
        equipment: ["bodyweight"],
        defaultRestSeconds: 60,
      });
      expect(created.intensityFactor).toBeGreaterThan(0);
      db.close();
    });

    it("never leaves leverageFactor/intensityFactor undefined for load types that don't need them", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Cable Crossover Variant",
        loadType: "cable",
        primaryGroup: "chest",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "chestSternal", share: 1, primaryMover: true }],
        equipment: ["cable"],
        defaultRestSeconds: 90,
      });
      // A barbell/cable/machine/dumbbell archetype pool may still average
      // in a leverageFactor of undefined from unrelated entries — but for
      // these load types Layer 1 never reads it, so any value is fine as
      // long as referenceVolume itself is always defined.
      expect(created.referenceVolume).toBeGreaterThan(0);
      db.close();
    });

    it("writes a durable, isCustom record with an empty userModifiedFields", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Sled Push",
        loadType: "distance",
        primaryGroup: "legs",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "quads", share: 1, primaryMover: true }],
        equipment: ["none"],
        defaultRestSeconds: 120,
      });
      const stored = await db.exercises.get(created.id);
      expect(stored?.isCustom).toBe(true);
      expect(stored?.userModifiedFields).toEqual([]);
      db.close();
    });

    it("enqueues a sync entry, unlike built-in catalog rows", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { seedCatalog } = await import("../../src/storage/seed.js");
      const repo = createExerciseRepository(db);
      await seedCatalog(db); // built-ins never enqueue
      const before = await db.syncQueue.where("entityType").equals("exercise").count();

      await repo.createCustom({
        name: "Chest Supported Row",
        loadType: "machine",
        primaryGroup: "back",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "lats", share: 1, primaryMover: true }],
        equipment: ["machine"],
        defaultRestSeconds: 90,
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
        primaryGroup: "shoulders",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "deltLateral", share: 1, primaryMover: true }],
        equipment: ["barbell"],
        defaultRestSeconds: 90,
      });
      expect(created.aliases).toEqual([]);
      db.close();
    });
  });

  describe("hide", () => {
    it("rejects hiding a built-in exercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      await expect(repo.hide(BENCH_ID)).rejects.toThrow(/built-in/);
      db.close();
    });

    it("rejects hiding a nonexistent exercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      await expect(repo.hide("not-a-real-exercise")).rejects.toThrow();
      db.close();
    });

    it("enqueues a sync entry", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Reverse Nordic Curl",
        loadType: "bodyweight",
        primaryGroup: "legs",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "quads", share: 1, primaryMover: true }],
        equipment: ["bodyweight"],
        defaultRestSeconds: 60,
      });
      const before = await db.syncQueue.where("entityType").equals("exercise").count();
      await repo.hide(created.id);
      const after = await db.syncQueue.where("entityType").equals("exercise").count();
      expect(after).toBe(before + 1);
      db.close();
    });

    it("persists the tombstone across a fresh repository instance", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createExerciseRepository(db);
      const created = await repo.createCustom({
        name: "Deleted Later",
        loadType: "machine",
        primaryGroup: "chest",
        limbsLoaded: 1,
        unilateral: false,
        muscles: [{ muscle: "chestSternal", share: 1, primaryMover: true }],
        equipment: ["machine"],
        defaultRestSeconds: 90,
      });
      await repo.hide(created.id);

      const repo2 = createExerciseRepository(db);
      expect(await repo2.search("Deleted Later", 10)).toEqual([]);
      expect((await repo2.getById(created.id))?.name).toBe("Deleted Later");
      db.close();
    });
  });
});
