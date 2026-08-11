import { describe, it, expect } from "vitest";
import { GymDatabase, SCHEMA_VERSION } from "../../src/storage/db.js";
import { exportData, importData } from "../../src/storage/exportImport.js";
import { seedCatalog } from "../../src/storage/seed.js";
import { createSettingsRepository } from "../../src/storage/repositories/settingsRepository.js";
import { createDeviceSettingsRepository } from "../../src/storage/repositories/deviceSettingsRepository.js";
import { createProfileRepository } from "../../src/storage/repositories/profileRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

async function seedRichDatabase(db: GymDatabase) {
  await seedCatalog(db);
  const deviceId = await db.getDeviceId();

  await db.routines.add({
    id: "routine1",
    name: "Push Day",
    note: null,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
  await db.routineExercises.add({
    id: "re1",
    routineId: "routine1",
    exerciseId: BENCH,
    orderIndex: 1000,
    supersetGroup: null,
    targetSets: 3,
    targetReps: 8,
    targetWeightKg: null,
    note: null,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
  await db.sessions.add({
    id: "session1",
    state: "completed",
    startedAt: 1000,
    endedAt: 2000,
    tzOffsetMinutes: 0,
    note: null,
    routineId: "routine1",
    lastActivityAt: 2000,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
  await db.sessionExercises.add({
    id: "se1",
    sessionId: "session1",
    exerciseId: BENCH,
    orderIndex: 1000,
    supersetGroup: null,
    note: null,
    substitutedFromId: null,
    plannedFromRoutineExerciseId: "re1",
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
  await db.sets.add({
    id: "set1",
    sessionExerciseId: "se1",
    exerciseId: BENCH,
    orderIndex: 1000,
    weightKg: 65,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    targetReps: 8,
    note: null,
    bodyweightKgAtTime: 80,
    loggedAt: 1000,
    restBeforeSec: null,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
  await db.bodyweightLog.add({
    id: "bw1",
    bodyweightKg: 80,
    recordedAt: 1000,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
  await createProfileRepository(db).update({ heightCm: 180 });
  await createDeviceSettingsRepository(db).update({ theme: "dark" });
}

describe("export/import (v2)", () => {
  describe("exportData", () => {
    it("bundles every raw table, including deviceSettings", async () => {
      const db = new GymDatabase(uniqueDbName());
      await seedRichDatabase(db);

      const bundle = await exportData(db);
      expect(bundle.schemaVersion).toBe(SCHEMA_VERSION);
      expect(bundle.exercises.length).toBeGreaterThan(80);
      expect(bundle.routines.length).toBe(1);
      expect(bundle.routineExercises.length).toBe(1);
      expect(bundle.sessions.length).toBe(1);
      expect(bundle.sessionExercises.length).toBe(1);
      expect(bundle.sets.length).toBe(1);
      expect(bundle.bodyweightLog.length).toBe(1);
      expect(bundle.profile.length).toBe(1);
      expect(bundle.settings.length).toBe(1);
      expect(bundle.deviceSettings.length).toBe(1);
      db.close();
    });
  });

  describe("importData", () => {
    it("round-trips every raw row onto a different database", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      const result = await importData(target, bundle);

      expect(result.sessions).toBe(1);
      expect(result.sessionExercises).toBe(1);
      expect(result.sets).toBe(1);
      expect(result.routines).toBe(1);
      expect(result.routineExercises).toBe(1);

      const importedSet = await target.sets.get("set1");
      expect(importedSet?.weightKg).toBe(65);
      expect(await target.profile.count()).toBe(1);
      expect(await target.deviceSettings.count()).toBe(1);
      source.close();
      target.close();
    });

    it("preserves the importing device's own installDeviceId rather than the backup's", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const sourceDeviceId = await source.getDeviceId();
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      const targetDeviceId = await target.getDeviceId();
      expect(targetDeviceId).not.toBe(sourceDeviceId);

      await importData(target, bundle);
      const settings = await target.settings.get("singleton");
      expect(settings?.installDeviceId).toBe(targetDeviceId);
      source.close();
      target.close();
    });

    it("restores other settings fields and the device-local theme from the backup", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      await createSettingsRepository(source).update({ units: "lb", weeklyTargetSessions: 5 });
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      await importData(target, bundle);
      const settings = await target.settings.get("singleton");
      expect(settings?.units).toBe("lb");
      expect(settings?.weeklyTargetSessions).toBe(5);
      const deviceSettings = await target.deviceSettings.get("singleton");
      expect(deviceSettings?.theme).toBe("dark");
      source.close();
      target.close();
    });

    it("fully replaces existing data rather than merging", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      const targetDeviceId = await target.getDeviceId();
      await target.sessions.add({
        id: "preexisting-session",
        state: "completed",
        startedAt: 99999,
        endedAt: 99999,
        tzOffsetMinutes: 0,
        note: null,
        routineId: null,
        lastActivityAt: 99999,
        updatedAt: Date.now(),
        deletedAt: null,
        deviceId: targetDeviceId,
        syncedAt: null,
        serverUpdatedAt: null,
      });

      await importData(target, bundle);
      expect(await target.sessions.get("preexisting-session")).toBeUndefined();
      expect(await target.sessions.count()).toBe(1);
      source.close();
      target.close();
    });

    it("refuses a backup from a newer schema version", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      await expect(importData(target, { ...bundle, schemaVersion: SCHEMA_VERSION + 1 })).rejects.toThrow(/newer schema version/);
      expect(await target.sessions.count()).toBe(0);
      source.close();
      target.close();
    });

    it("rejects a malformed backup with no settings row", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      await expect(importData(target, { ...bundle, settings: [] })).rejects.toThrow(/settings row/);
      source.close();
      target.close();
    });

    it("handles a bundle with an empty profile/deviceSettings gracefully", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedCatalog(source); // no profile/deviceSettings write
      const bundle = await exportData(source);
      expect(bundle.profile).toEqual([]);
      expect(bundle.deviceSettings).toEqual([]);

      const target = new GymDatabase(uniqueDbName());
      await expect(importData(target, bundle)).resolves.toBeDefined();
      expect(await target.profile.count()).toBe(0);
      expect(await target.deviceSettings.count()).toBe(0);
      source.close();
      target.close();
    });
  });

  // Spec §14 DoD: "Export -> wipe -> import round-trips a 12-week history
  // losslessly." Same database throughout — this is the backup/restore
  // story, not a cross-device migration.
  it("export -> wipe -> import round-trips a 12-week history with no loss", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    const { seedDevHistory } = await import("../../src/storage/devSeed.js");
    const { createDerivedStateRepository } = await import("../../src/storage/repositories/derivedStateRepository.js");
    const seedResult = await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });

    const derived = createDerivedStateRepository(db);
    await derived.rebuildDerivedState();

    const bundle = await exportData(db);
    const preWipeXp = await derived.getAllMuscleXp();
    const preWipeBenchPr = await derived.getPrSnapshot(BENCH);

    await db.exercises.clear();
    await db.routines.clear();
    await db.routineExercises.clear();
    await db.sessions.clear();
    await db.sessionExercises.clear();
    await db.sets.clear();
    await db.bodyweightLog.clear();
    await db.profile.clear();
    await db.settings.clear();
    await db.deviceSettings.clear();
    await db.prCache.clear();
    await db.muscleXpCache.clear();
    expect(await db.sessions.count()).toBe(0);

    const result = await importData(db, bundle);
    expect(result.sessions).toBe(seedResult.sessionCount);
    expect(result.sets).toBe(seedResult.setCount);
    expect(await db.exercises.count()).toBe(bundle.exercises.length);

    // importData doesn't rebuild caches itself (task 5 predates task 14 in
    // the build sequence) — rebuild explicitly, then confirm no loss
    // relative to the pre-wipe snapshot.
    await derived.rebuildDerivedState();
    expect(await derived.getAllMuscleXp()).toEqual(preWipeXp);
    expect(await derived.getPrSnapshot(BENCH)).toEqual(preWipeBenchPr);
    db.close();
  });
});
