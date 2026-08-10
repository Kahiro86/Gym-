import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { seedDevHistory } from "../../src/storage/devSeed.js";
import { createDerivedStateRepository } from "../../src/storage/repositories/derivedStateRepository.js";
import { exportData } from "../../src/storage/exportImport.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("seedDevHistory", () => {
  it("generates the expected counts for a 12-week, 3-day/week split", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedDevHistory(db, { startedAt: 0, weeks: 12 });

    // 12 weeks x 3 sessions/week x (2 exercises x 3 sets) = 216 sets.
    expect(result.sessionCount).toBe(36);
    expect(result.setCount).toBe(216);
    expect(result.bodyweightEntryCount).toBe(36);
    expect(await db.sessions.count()).toBe(36);
    expect(await db.sets.count()).toBe(216);
    db.close();
  });

  it("respects a custom week count", async () => {
    const db = new GymDatabase(uniqueDbName());
    const result = await seedDevHistory(db, { startedAt: 0, weeks: 4 });
    expect(result.sessionCount).toBe(12);
    expect(result.setCount).toBe(72);
    db.close();
  });

  it("is deterministic — the same options produce structurally identical output on a fresh database", async () => {
    const dbA = new GymDatabase(uniqueDbName());
    const dbB = new GymDatabase(uniqueDbName());
    await seedDevHistory(dbA, { startedAt: 0, weeks: 6 });
    await seedDevHistory(dbB, { startedAt: 0, weeks: 6 });

    // id/sessionId (fresh UUIDs), deviceId (per-database identity), and
    // updatedAt (wall-clock write time) legitimately differ between two
    // independently seeded databases — everything else, driven purely by
    // the generator's own deterministic math, must match exactly.
    const strip = (rows: { id: string; sessionId?: string; deviceId: string; updatedAt: number }[]) =>
      rows
        .map(({ id: _id, sessionId: _sessionId, deviceId: _deviceId, updatedAt: _updatedAt, ...rest }) => rest)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    const setsA = strip(await dbA.sets.toArray());
    const setsB = strip(await dbB.sets.toArray());
    expect(setsA).toEqual(setsB);

    const sessionsA = strip(await dbA.sessions.toArray());
    const sessionsB = strip(await dbB.sessions.toArray());
    expect(sessionsA).toEqual(sessionsB);
    dbA.close();
    dbB.close();
  });

  it("progressively increases weight week over week for the same exercise", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12 });

    const benchSets = (await db.sets.toArray())
      .filter((s) => s.exerciseId === "barbell-bench-press")
      .sort((a, b) => a.loggedAt - b.loggedAt);

    const firstWeekWeight = benchSets[0]!.weightKg!;
    const lastWeekWeight = benchSets[benchSets.length - 1]!.weightKg!;
    expect(lastWeekWeight).toBeGreaterThan(firstWeekWeight);
    db.close();
  });

  it("produces a history that rebuilds derived state and exports without error", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12 });

    const derived = createDerivedStateRepository(db);
    await derived.rebuildDerivedState();
    const allXp = await derived.getAllMuscleXp();
    expect(Object.values(allXp).some((xp) => xp > 0)).toBe(true);

    const bundle = await exportData(db);
    expect(bundle.sessions.length).toBe(36);
    expect(bundle.sets.length).toBe(216);
    db.close();
  });

  it("never leaves more than one active (unfinished) session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedDevHistory(db, { startedAt: 0, weeks: 12 });
    const active = await db.sessions.filter((s) => s.endedAt === null).toArray();
    expect(active).toEqual([]);
    db.close();
  });
});
