import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createHeatmapRepository } from "../../src/storage/repositories/heatmapRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { MUSCLE_IDS } from "../../src/domain/muscles.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";
const DAY = 24 * 60 * 60 * 1000;

async function logCompletedSession(db: GymDatabase, exerciseId: string, startedAt: number) {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const sets = createSetRepository(db);

  const session = await sessions.create({ startedAt });
  const se = await sessionExercises.add({ sessionId: session.id, exerciseId });
  await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 8, bodyweightKgAtTime: 80, loggedAt: startedAt });
  await sessions.finish(session.id, startedAt + 60_000);
  return session;
}

describe("HeatmapRepository", () => {
  it("returns a zero-heat, never-trained entry for every muscle on an empty database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const heatmap = createHeatmapRepository(db);

    const map = await heatmap.getRecencyMap(Date.now());
    expect(map).toHaveLength(MUSCLE_IDS.length);
    expect(map.every((entry) => entry.heat === 0 && entry.daysSinceTrained === null)).toBe(true);
    db.close();
  });

  it("gives a just-trained muscle positive heat and ~0 days since trained, leaving others untouched", async () => {
    const db = new GymDatabase(uniqueDbName());
    const heatmap = createHeatmapRepository(db);
    const now = Date.now();

    await logCompletedSession(db, BENCH, now);

    const map = await heatmap.getRecencyMap(now);
    const chest = map.find((e) => e.muscleId === "chestSternal")!;
    const quads = map.find((e) => e.muscleId === "quads")!;

    expect(chest.heat).toBeGreaterThan(0);
    expect(chest.daysSinceTrained).not.toBeNull();
    expect(chest.daysSinceTrained!).toBeLessThan(0.01);
    expect(quads.heat).toBe(0);
    expect(quads.daysSinceTrained).toBeNull();
    db.close();
  });

  it("decays heat for a muscle not trained in a while relative to one trained just now", async () => {
    const db = new GymDatabase(uniqueDbName());
    const heatmap = createHeatmapRepository(db);
    const now = Date.now();

    // Two different sessions two weeks apart, so each week's rollup only
    // has the one exercise in it — deliberately not the same session, so
    // this exercises applySessionToRollup's week-bucketing (§5), not just
    // a single upsert.
    await logCompletedSession(db, BENCH, now - 14 * DAY);
    await logCompletedSession(db, BENCH, now);

    const map = await heatmap.getRecencyMap(now);
    const chest = map.find((e) => e.muscleId === "chestSternal")!;
    expect(chest.heat).toBeGreaterThan(0);

    const staleMap = await heatmap.getRecencyMap(now + 30 * DAY);
    const staleChest = staleMap.find((e) => e.muscleId === "chestSternal")!;
    expect(staleChest.heat).toBeLessThan(chest.heat);
    db.close();
  });

  it("ignores warmup sets, incomplete sets, and non-completed sessions", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const heatmap = createHeatmapRepository(db);
    const now = Date.now();

    const session = await sessions.create({ startedAt: now });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 20, reps: 8, bodyweightKgAtTime: 80, loggedAt: now, isWarmup: true });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 8, bodyweightKgAtTime: 80, loggedAt: now, completed: false });
    // Session never finished with a completed set, so it stays in_progress
    // (finish() would discard it) — either way it must not heat anything.

    const map = await heatmap.getRecencyMap(now);
    expect(map.every((entry) => entry.heat === 0)).toBe(true);
    db.close();
  });
});
