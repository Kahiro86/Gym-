import { describe, it, expect } from "vitest";
import { GymDatabase, SCHEMA_VERSION } from "../../src/storage/db.js";
import { exportData, importData } from "../../src/storage/exportImport.js";
import { seedCatalog } from "../../src/storage/seed.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createBodyweightRepository } from "../../src/storage/repositories/bodyweightRepository.js";
import { createExerciseRepository } from "../../src/storage/repositories/exerciseRepository.js";
import { createDerivedStateRepository } from "../../src/storage/repositories/derivedStateRepository.js";
import { seedDevHistory } from "../../src/storage/devSeed.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

async function seedRichDatabase(db: GymDatabase) {
  await seedCatalog(db);
  const sessions = createSessionRepository(db);
  const sets = createSetRepository(db);
  const bodyweight = createBodyweightRepository(db);
  const exercises = createExerciseRepository(db);

  const session = await sessions.create({ startedAt: 1000 });
  await sets.log({ sessionId: session.id, exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
  await sets.log({ sessionId: session.id, exerciseId: BENCH, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1100 });
  await sessions.finish(session.id, 1200);
  await bodyweight.log({ bodyweightKg: 80, recordedAt: 1000 });
  await exercises.createCustom({
    name: "Garage Press",
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
    equipment: ["barbell"],
    referenceVolume: 100,
    defaultRestSeconds: 90,
  });
}

describe("export/import", () => {
  describe("exportData", () => {
    it("bundles all four raw tables plus schemaVersion/exportedAt, excluding caches and the sync queue", async () => {
      const db = new GymDatabase(uniqueDbName());
      await seedRichDatabase(db);
      await createDerivedStateRepository(db).rebuildDerivedState();

      const bundle = await exportData(db);
      expect(bundle.schemaVersion).toBe(SCHEMA_VERSION);
      expect(bundle.exportedAt).toBeGreaterThan(0);
      expect(bundle.exercises.length).toBeGreaterThan(80); // seeded catalog + 1 custom
      expect(bundle.sessions.length).toBe(1);
      expect(bundle.sets.length).toBe(2);
      expect(bundle.bodyweightLog.length).toBe(1);
      expect(bundle.settings.length).toBe(1);
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

      expect(result).toEqual({
        exercises: bundle.exercises.length,
        sessions: bundle.sessions.length,
        sets: bundle.sets.length,
        bodyweightLog: bundle.bodyweightLog.length,
      });
      expect(await target.exercises.count()).toBe(bundle.exercises.length);
      expect(await target.sessions.count()).toBe(1);
      expect(await target.sets.count()).toBe(2);
      expect(await target.bodyweightLog.count()).toBe(1);

      const importedSet = (await target.sets.toArray()).find((s) => s.weightKg === 65);
      expect(importedSet).toBeDefined();
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
      expect(settings?.units).toBe(bundle.settings[0]!.units); // other fields still come from the backup
      source.close();
      target.close();
    });

    it("restores other settings fields from the backup", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const { createSettingsRepository } = await import("../../src/storage/repositories/settingsRepository.js");
      await createSettingsRepository(source).update({ units: "lb", theme: "dark", weeklyTargetSessions: 5 });
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      await importData(target, bundle);
      const settings = await target.settings.get("singleton");
      expect(settings?.units).toBe("lb");
      expect(settings?.theme).toBe("dark");
      expect(settings?.weeklyTargetSessions).toBe(5);
      source.close();
      target.close();
    });

    it("fully replaces existing data rather than merging", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      const sessions = createSessionRepository(target);
      const preexisting = await sessions.create({ startedAt: 99999 });

      await importData(target, bundle);
      expect(await target.sessions.get(preexisting.id)).toBeUndefined();
      expect(await target.sessions.count()).toBe(1);
      source.close();
      target.close();
    });

    it("rebuilds derived caches so they reflect the imported data, not the pre-import state", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      await importData(target, bundle);

      const derived = createDerivedStateRepository(target);
      const prSnapshot = await derived.getPrSnapshot(BENCH);
      expect(prSnapshot.maxWeightKg).toBe(65);
      source.close();
      target.close();
    });

    it("refuses a backup from a newer schema version", async () => {
      const source = new GymDatabase(uniqueDbName());
      await seedRichDatabase(source);
      const bundle = await exportData(source);

      const target = new GymDatabase(uniqueDbName());
      await expect(importData(target, { ...bundle, schemaVersion: SCHEMA_VERSION + 1 })).rejects.toThrow(/newer schema version/);
      expect(await target.sessions.count()).toBe(0); // rejected before touching anything
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
  });

  // Spec §11 DoD: "Export -> wipe -> import round-trips a 12-week history
  // with no loss." Same database throughout — this is the backup/restore
  // story, not a cross-device migration.
  it("export -> wipe -> import round-trips a 12-week history with no loss", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    await seedDevHistory(db, { startedAt: 0, weeks: 12 });
    const derived = createDerivedStateRepository(db);
    await derived.rebuildDerivedState();

    const bundle = await exportData(db);
    const preWipeXp = await derived.getAllMuscleXp();
    const preWipeBenchPr = await derived.getPrSnapshot(BENCH);

    await db.exercises.clear();
    await db.sessions.clear();
    await db.sets.clear();
    await db.bodyweightLog.clear();
    await db.settings.clear();
    await db.prCache.clear();
    await db.muscleXpCache.clear();
    expect(await db.sessions.count()).toBe(0);

    const result = await importData(db, bundle);
    expect(result.sessions).toBe(36);
    expect(result.sets).toBe(216);
    expect(result.bodyweightLog).toBe(36);
    expect(await db.exercises.count()).toBe(bundle.exercises.length);

    // importData rebuilds the caches itself — no loss relative to the
    // pre-wipe snapshot.
    expect(await derived.getAllMuscleXp()).toEqual(preWipeXp);
    expect(await derived.getPrSnapshot(BENCH)).toEqual(preWipeBenchPr);
    db.close();
  });
});
