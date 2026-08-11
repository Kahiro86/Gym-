import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { seedCatalog } from "../../src/storage/seed.js";
import { EXERCISE_CATALOG } from "../../src/domain/catalog.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

function fakeSet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "set1",
    sessionExerciseId: "se1",
    exerciseId: BENCH,
    orderIndex: 1000,
    weightKg: 60,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    targetReps: null,
    note: null,
    bodyweightKgAtTime: 80,
    loggedAt: 1000,
    restBeforeSec: null,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId: "d",
    syncedAt: null,
    serverUpdatedAt: null,
    ...overrides,
  };
}

describe("seedCatalog", () => {
  it("inserts every catalog exercise into an empty database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedCatalog(db);
    expect(result.inserted).toBe(EXERCISE_CATALOG.length);
    expect(await db.exercises.count()).toBe(EXERCISE_CATALOG.length);
    db.close();
  });

  it("is idempotent — a second call writes nothing", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    const second = await seedCatalog(db);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.removed).toBe(0);
    expect(second.skipped).toBe(EXERCISE_CATALOG.length);
    db.close();
  });

  it("never overwrites a user-created exercise on an id collision", async () => {
    const db = new GymDatabase(uniqueDbName());
    const deviceId = await db.getDeviceId();
    await db.exercises.add({
      id: BENCH,
      name: "My Custom Bench Variant",
      aliases: [],
      loadType: "barbell",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [],
      equipment: ["barbell"],
      referenceVolume: 999,
      defaultRestSeconds: 90,
      isCustom: true,
      userModifiedFields: [],
      updatedAt: Date.now(),
      deletedAt: null,
      deviceId,
      syncedAt: null,
      serverUpdatedAt: null,
    });

    await seedCatalog(db);
    const row = await db.exercises.get(BENCH);
    expect(row?.name).toBe("My Custom Bench Variant");
    expect(row?.isCustom).toBe(true);
    db.close();
  });

  it("preserves a local soft-delete of a built-in across re-seed", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    await db.exercises.update(BENCH, { deletedAt: Date.now() });

    await seedCatalog(db);
    const row = await db.exercises.get(BENCH);
    expect(row?.deletedAt).not.toBeNull();
    db.close();
  });

  it("preserves a user-edited field while refreshing untouched fields to the latest source", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);

    await db.exercises.update(BENCH, {
      name: "My Renamed Bench",
      userModifiedFields: ["name"],
      defaultRestSeconds: 1, // drifted, NOT tracked as user-modified
    });

    const result = await seedCatalog(db);
    const row = await db.exercises.get(BENCH);
    expect(row?.name).toBe("My Renamed Bench"); // preserved
    const catalogValue = EXERCISE_CATALOG.find((e) => e.id === BENCH)!.defaultRestSeconds;
    expect(row?.defaultRestSeconds).toBe(catalogValue); // refreshed back
    expect(result.updated).toBeGreaterThan(0);
    db.close();
  });

  it("always refreshes leverageFactor/referenceVolume even if userModifiedFields claims they were edited", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);

    await db.exercises.update(BENCH, {
      referenceVolume: 1,
      userModifiedFields: ["referenceVolume"],
    });

    await seedCatalog(db);
    const row = await db.exercises.get(BENCH);
    const catalogValue = EXERCISE_CATALOG.find((e) => e.id === BENCH)!.referenceVolume;
    expect(row?.referenceVolume).toBe(catalogValue);
    db.close();
  });

  it("soft-deletes a removed built-in that was never logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const deviceId = await db.getDeviceId();
    await db.exercises.add({
      id: "removed-exercise",
      name: "No Longer In The Catalog",
      aliases: [],
      loadType: "barbell",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [],
      equipment: ["barbell"],
      referenceVolume: 100,
      defaultRestSeconds: 90,
      isCustom: false,
      userModifiedFields: [],
      updatedAt: Date.now(),
      deletedAt: null,
      deviceId,
      syncedAt: null,
      serverUpdatedAt: null,
    });

    const result = await seedCatalog(db);
    expect(result.removed).toBe(1);
    const row = await db.exercises.get("removed-exercise");
    expect(row?.deletedAt).not.toBeNull();
    db.close();
  });

  it("never soft-deletes a removed built-in the user has logged history against", async () => {
    const db = new GymDatabase(uniqueDbName());
    const deviceId = await db.getDeviceId();
    await db.exercises.add({
      id: "removed-but-logged",
      name: "No Longer In The Catalog",
      aliases: [],
      loadType: "barbell",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [],
      equipment: ["barbell"],
      referenceVolume: 100,
      defaultRestSeconds: 90,
      isCustom: false,
      userModifiedFields: [],
      updatedAt: Date.now(),
      deletedAt: null,
      deviceId,
      syncedAt: null,
      serverUpdatedAt: null,
    });
    await db.sets.add(fakeSet({ id: "set-against-removed", exerciseId: "removed-but-logged" }));

    const result = await seedCatalog(db);
    expect(result.removed).toBe(0);
    const row = await db.exercises.get("removed-but-logged");
    expect(row?.deletedAt).toBeNull();
    db.close();
  });

  it("never enqueues built-in rows to syncQueue", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    expect(await db.syncQueue.where("entityType").equals("exercise").count()).toBe(0);
    db.close();
  });
});
