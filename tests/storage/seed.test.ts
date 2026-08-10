import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { seedCatalog } from "../../src/storage/seed.js";
import { EXERCISE_CATALOG } from "../../src/domain/catalog.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("seedCatalog", () => {
  it("inserts every catalog entry on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedCatalog(db);
    expect(result.inserted).toBe(EXERCISE_CATALOG.length);
    expect(result.updated).toBe(0);

    const count = await db.exercises.count();
    expect(count).toBe(EXERCISE_CATALOG.length);
    db.close();
  });

  it("is idempotent — re-seeding an unchanged database writes nothing", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    const second = await seedCatalog(db);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(EXERCISE_CATALOG.length);
    db.close();
  });

  it("never overwrites a user-created exercise that happens to share an id", async () => {
    const db = new GymDatabase(uniqueDbName());
    const collidingId = EXERCISE_CATALOG[0]!.id;
    const deviceId = await db.getDeviceId();

    await db.exercises.put({
      id: collidingId,
      name: "My Custom Version",
      aliases: [],
      loadType: "barbell",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [],
      equipment: [],
      referenceVolume: 999,
      defaultRestSeconds: 60,
      isCustom: true,
      updatedAt: 1,
      deletedAt: null,
      deviceId,
      syncedAt: null,
    });

    const result = await seedCatalog(db);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const row = await db.exercises.get(collidingId);
    expect(row?.name).toBe("My Custom Version");
    expect(row?.isCustom).toBe(true);
    db.close();
  });

  it("preserves a user's local deletion of a built-in exercise across re-seed", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);

    const targetId = EXERCISE_CATALOG[0]!.id;
    const deletedAt = Date.now();
    await db.exercises.update(targetId, { deletedAt });

    await seedCatalog(db);
    const row = await db.exercises.get(targetId);
    expect(row?.deletedAt).toBe(deletedAt);
    db.close();
  });

  it("updates a built-in row whose stored content has drifted from the current catalog", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);

    const target = EXERCISE_CATALOG[0]!;
    await db.exercises.update(target.id, { referenceVolume: 1 });

    const result = await seedCatalog(db);
    expect(result.updated).toBe(1);

    const row = await db.exercises.get(target.id);
    expect(row?.referenceVolume).toBe(target.referenceVolume);
    db.close();
  });
});
