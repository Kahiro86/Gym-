import { describe, it, expect, vi, afterEach } from "vitest";
import { GymDatabase, isIndexedDbAvailable, openDatabaseSafely, openDatabase } from "../../src/storage/db.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("GymDatabase schema v2", () => {
  it("declares every v2 table", async () => {
    const db = new GymDatabase(uniqueDbName());
    await db.open();
    const tableNames = db.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(
      [
        "bodyweightLog",
        "deviceSettings",
        "exercises",
        "muscleXpCache",
        "prCache",
        "profile",
        "routineExercises",
        "routines",
        "sessionExercises",
        "sessions",
        "settings",
        "sets",
        "syncLog",
        "syncQueue",
      ].sort()
    );
    db.close();
  });

  it("writes, reopens, and reads back", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    await db1.exercises.add({
      id: "ex1",
      name: "Test Exercise",
      aliases: [],
      loadType: "barbell",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [],
      equipment: ["barbell"],
      referenceVolume: 100,
      defaultRestSeconds: 90,
      isCustom: true,
      userModifiedFields: [],
      updatedAt: Date.now(),
      deletedAt: null,
      deviceId: "d1",
      syncedAt: null,
      serverUpdatedAt: null,
    });
    db1.close();

    const db2 = new GymDatabase(name);
    const row = await db2.exercises.get("ex1");
    expect(row?.name).toBe("Test Exercise");
    db2.close();
  });

  it("deviceId persists across reopen", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    const id1 = await db1.getDeviceId();
    db1.close();

    const db2 = new GymDatabase(name);
    const id2 = await db2.getDeviceId();
    expect(id2).toBe(id1);
    db2.close();
  });

  it("getOrCreateSettings is idempotent under concurrent calls", async () => {
    const db = new GymDatabase(uniqueDbName());
    const [a, b, c] = await Promise.all([db.getOrCreateSettings(), db.getOrCreateSettings(), db.getOrCreateSettings()]);
    expect(a.installDeviceId).toBe(b.installDeviceId);
    expect(b.installDeviceId).toBe(c.installDeviceId);
    expect(await db.settings.count()).toBe(1);
    db.close();
  });

  it("settings defaults match spec", async () => {
    const db = new GymDatabase(uniqueDbName());
    const settings = await db.getOrCreateSettings();
    expect(settings.units).toBe("kg");
    expect(settings.weeklyTargetSessions).toBeNull();
    expect(settings.defaultRestSeconds).toBe(120);
    db.close();
  });

  it("device settings defaults match spec and never carry sync columns", async () => {
    const db = new GymDatabase(uniqueDbName());
    const deviceSettings = await db.getOrCreateDeviceSettings();
    expect(deviceSettings.theme).toBe("system");
    expect(deviceSettings.persistenceGranted).toBe(false);
    expect("deviceId" in deviceSettings).toBe(false);
    expect("syncedAt" in deviceSettings).toBe(false);
    db.close();
  });

  it("profile defaults to nulls and reuses the device's identity as its deviceId", async () => {
    const db = new GymDatabase(uniqueDbName());
    const deviceId = await db.getDeviceId();
    const profile = await db.getOrCreateProfile();
    expect(profile.heightCm).toBeNull();
    expect(profile.birthDate).toBeNull();
    expect(profile.sex).toBeNull();
    expect(profile.deviceId).toBe(deviceId);
    db.close();
  });

  it("openDatabase opens a plain, non-degraded database", () => {
    const db = openDatabase(uniqueDbName());
    expect(db).toBeInstanceOf(GymDatabase);
    db.close();
  });
});

describe("IndexedDB availability", () => {
  it("isIndexedDbAvailable is true under fake-indexeddb (installed globally in tests/setup.ts)", async () => {
    expect(await isIndexedDbAvailable()).toBe(true);
  });

  describe("with indexedDB undefined", () => {
    const original = globalThis.indexedDB;
    afterEach(() => {
      globalThis.indexedDB = original;
    });

    it("reports unavailable", async () => {
      // @ts-expect-error deliberately simulating an environment with no IndexedDB
      delete globalThis.indexedDB;
      expect(await isIndexedDbAvailable()).toBe(false);
    });
  });

  describe("openDatabaseSafely", () => {
    const original = globalThis.indexedDB;
    afterEach(() => {
      globalThis.indexedDB = original;
      vi.restoreAllMocks();
    });

    it("returns degraded: false when IndexedDB is available", async () => {
      const result = await openDatabaseSafely(uniqueDbName());
      expect(result.degraded).toBe(false);
      result.db.close();
    });

    it("falls back to an in-memory engine, running the same schema, when IndexedDB is unavailable", async () => {
      // @ts-expect-error deliberately simulating an environment with no IndexedDB
      delete globalThis.indexedDB;

      const result = await openDatabaseSafely(uniqueDbName());
      expect(result.degraded).toBe(true);

      // Same repository-facing behavior as a normal database — a write
      // durable within this in-memory session.
      const settings = await result.db.getOrCreateSettings();
      expect(settings.units).toBe("kg");
      result.db.close();
    });
  });
});
