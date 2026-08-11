import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { seedDevHistory } from "../../src/storage/devSeed.js";
import { createDerivedStateRepository } from "../../src/storage/repositories/derivedStateRepository.js";
import { exportData } from "../../src/storage/exportImport.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("seedDevHistory", () => {
  it("generates internally consistent counts for a 12-week, 3-day/week split", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });

    expect(result.sessionCount + result.skippedSessionCount).toBe(36);
    expect(result.bodyweightEntryCount).toBe(36); // logged even on skipped days
    expect(await db.sessions.count()).toBe(result.sessionCount);
    expect(await db.bodyweightLog.count()).toBe(36);
    db.close();
  });

  it("occasionally skips a session (realistic gaps), not every single one", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });
    expect(result.skippedSessionCount).toBeGreaterThan(0);
    expect(result.sessionCount).toBeGreaterThan(result.skippedSessionCount);
    db.close();
  });

  it("respects a custom week count", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedDevHistory(db, { startedAt: 0, weeks: 4, seed: 42 });
    expect(result.sessionCount + result.skippedSessionCount).toBe(12);
    db.close();
  });

  it("is deterministic — the same seed and options reproduce byte-identical output", async () => {
    const dbA = new GymDatabase(uniqueDbName());
    const dbB = new GymDatabase(uniqueDbName());
    const resultA = await seedDevHistory(dbA, { startedAt: 0, weeks: 6, seed: 7 });
    const resultB = await seedDevHistory(dbB, { startedAt: 0, weeks: 6, seed: 7 });

    expect(resultA).toEqual(resultB);

    // id/sessionExerciseId (fresh UUIDs) and deviceId/updatedAt (per-database
    // identity and wall-clock write time) legitimately differ between two
    // independently seeded databases — everything else, driven purely by
    // the generator's own seeded math, must match exactly.
    const strip = (rows: { id: string; sessionExerciseId?: string; deviceId: string; updatedAt: number }[]) =>
      rows
        .map(({ id: _id, sessionExerciseId: _seId, deviceId: _deviceId, updatedAt: _updatedAt, ...rest }) => rest)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    expect(strip(await dbA.sets.toArray())).toEqual(strip(await dbB.sets.toArray()));
    expect(strip(await dbA.sessions.toArray())).toEqual(strip(await dbB.sessions.toArray()));
    dbA.close();
    dbB.close();
  });

  it("produces different output for a different seed", async () => {
    const dbA = new GymDatabase(uniqueDbName());
    const dbB = new GymDatabase(uniqueDbName());
    const resultA = await seedDevHistory(dbA, { startedAt: 0, weeks: 6, seed: 1 });
    const resultB = await seedDevHistory(dbB, { startedAt: 0, weeks: 6, seed: 2 });
    expect(resultA).not.toEqual(resultB);
    dbA.close();
    dbB.close();
  });

  it("varies reps around each exercise's target rather than logging identical sets forever", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });
    const benchReps = new Set((await db.sets.toArray()).filter((s) => s.exerciseId === "barbell-bench-press" && !s.isWarmup).map((s) => s.reps));
    expect(benchReps.size).toBeGreaterThan(1);
    db.close();
  });

  it("includes some warmup sets and at least one failed attempt across the history", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });
    const allSets = await db.sets.toArray();
    expect(allSets.some((s) => s.isWarmup)).toBe(true);
    expect(allSets.some((s) => !s.completed)).toBe(true);
    db.close();
  });

  it("produces a history that rebuilds derived state and exports without error", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });

    const derived = createDerivedStateRepository(db);
    await derived.rebuildDerivedState();
    const allXp = await derived.getAllMuscleXp();
    expect(Object.values(allXp).some((xp) => xp > 0)).toBe(true);

    const bundle = await exportData(db);
    expect(bundle.sets.length).toBeGreaterThan(0);
    expect(bundle.sessions.length).toBeGreaterThan(0);
    db.close();
  });

  it("never leaves more than one in_progress session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });
    const active = await db.sessions.where("state").equals("in_progress").toArray();
    expect(active).toEqual([]);
    db.close();
  });

  it("never leaves a discarded session — every generated session has real completed sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12, seed: 42 });
    const discarded = await db.sessions.where("state").equals("discarded").toArray();
    expect(discarded).toEqual([]);
    db.close();
  });
});
