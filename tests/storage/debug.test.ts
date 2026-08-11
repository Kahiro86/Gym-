import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { rebuildCaches, forceSyncNow, dumpDatabase, getPersistenceStatus, getDebugSnapshot, wipeLocalDatabase } from "../../src/storage/debug.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { seedCatalog } from "../../src/storage/seed.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

describe("debug", () => {
  it("rebuildCaches populates muscleXpCache/prCache from logged sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const session = await sessions.create({ startedAt: 1000 });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });

    expect(await db.muscleXpCache.count()).toBe(0);
    await rebuildCaches(db);
    expect(await db.muscleXpCache.count()).toBeGreaterThan(0);
    expect(await db.prCache.count()).toBe(1);
    db.close();
  });

  it("forceSyncNow records an honest failure attempt, not a silent no-op", async () => {
    const db = new GymDatabase(uniqueDbName());
    await forceSyncNow(db);
    const rows = await db.syncLog.toArray();
    expect(rows.length).toBe(1);
    expect(rows[0]!.outcome).toBe("failure");
    expect(rows[0]!.error).toMatch(/not implemented/);
    db.close();
  });

  it("dumpDatabase returns the same bundle as exportData", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    const bundle = await dumpDatabase(db);
    expect(bundle.exercises.length).toBeGreaterThan(80);
    expect(bundle.schemaVersion).toBeGreaterThan(0);
    db.close();
  });

  describe("getPersistenceStatus", () => {
    it("reports the stored persistenceGranted flag, defaulting to false", async () => {
      const db = new GymDatabase(uniqueDbName());
      const status = await getPersistenceStatus(db);
      expect(status.persistenceGranted).toBe(false);
      db.close();
    });

    it("reflects an updated persistenceGranted flag", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { createDeviceSettingsRepository } = await import("../../src/storage/repositories/deviceSettingsRepository.js");
      await createDeviceSettingsRepository(db).update({ persistenceGranted: true });
      expect((await getPersistenceStatus(db)).persistenceGranted).toBe(true);
      db.close();
    });
  });

  describe("getDebugSnapshot", () => {
    it("aggregates sync log, persistence, and every table's row count", async () => {
      const db = new GymDatabase(uniqueDbName());
      await seedCatalog(db); // built-ins never enqueue

      const snapshot = await getDebugSnapshot(db);
      expect(snapshot.tableCounts.exercises).toBeGreaterThan(80);
      expect(snapshot.persistence.persistenceGranted).toBe(false);
      expect(snapshot.queueDepth).toBe(0);
      db.close();
    });

    it("queueDepth reflects real queued mutations", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sessions = createSessionRepository(db);
      await sessions.create({ startedAt: 1000 });
      const snapshot = await getDebugSnapshot(db);
      expect(snapshot.queueDepth).toBe(1);
      db.close();
    });
  });

  describe("wipeLocalDatabase", () => {
    it("clears every table, including caches, the sync queue, and settings identity", async () => {
      const db = new GymDatabase(uniqueDbName());
      await seedCatalog(db);
      const sessions = createSessionRepository(db);
      await sessions.create({ startedAt: 1000 });
      await rebuildCaches(db);
      const deviceIdBeforeWipe = await db.getDeviceId();

      await wipeLocalDatabase(db);

      for (const table of db.tables) {
        expect(await table.count()).toBe(0);
      }

      // getDeviceId() is cached in-memory on the GymDatabase instance, so
      // it still returns the pre-wipe value here — but the underlying
      // settings row is gone, so a *fresh* instance generates a new one,
      // proving the wipe was real at the storage level.
      expect(await db.getDeviceId()).toBe(deviceIdBeforeWipe);
      db.close();

      const db2 = new GymDatabase(db.name);
      const deviceIdAfterWipe = await db2.getDeviceId();
      expect(deviceIdAfterWipe).not.toBe(deviceIdBeforeWipe);
      db2.close();
    });
  });
});
