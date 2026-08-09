import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryMuscleRollupStore,
  weekStartFor,
  addWeeks,
  applySessionToRollup,
  recomputeWeekRollup,
} from "../../src/heatmap/store.js";
import type { HeatmapSessionInput } from "../../src/heatmap/store.js";
import type { LoggedSet } from "../../src/domain/types.js";

const DAY = 86_400_000;
// A Monday 12:00 UTC, safely mid-week.
const MONDAY_NOON = Date.UTC(2026, 7, 10, 12, 0, 0); // 2026-08-10 is a Monday

describe("weekStartFor / addWeeks", () => {
  it("buckets any day in a week to that week's Monday", () => {
    const monday = weekStartFor(MONDAY_NOON);
    for (let d = 0; d < 7; d++) {
      expect(weekStartFor(MONDAY_NOON + d * DAY)).toBe(monday);
    }
    expect(weekStartFor(MONDAY_NOON + 7 * DAY)).not.toBe(monday);
  });

  it("addWeeks moves by whole weeks and composes with weekStartFor", () => {
    const monday = weekStartFor(MONDAY_NOON);
    expect(addWeeks(monday, 1)).toBe(weekStartFor(MONDAY_NOON + 7 * DAY));
    expect(addWeeks(monday, -1)).toBe(weekStartFor(MONDAY_NOON - 7 * DAY));
  });
});

describe("applySessionToRollup — scoring", () => {
  let store: InMemoryMuscleRollupStore;
  beforeEach(() => {
    store = new InMemoryMuscleRollupStore();
  });

  it("a bodyweight exercise produces nonzero volume (regression: the pushup bug)", () => {
    const session: HeatmapSessionInput = {
      sets: [{ exerciseId: "pushup", reps: 15, timestamp: MONDAY_NOON }],
      bodyweightKg: 80,
    };
    applySessionToRollup(store, session);
    const row = store.get("pecSternal", weekStartFor(MONDAY_NOON));
    expect(row).toBeDefined();
    expect(row!.totalVolume).toBeGreaterThan(0);
  });

  it("warmup sets contribute volume just like any other set (no gating)", () => {
    const lightSet: LoggedSet = { exerciseId: "barbell-bench-press", weightKg: 20, reps: 10, timestamp: MONDAY_NOON };
    applySessionToRollup(store, { sets: [lightSet], bodyweightKg: 80 });
    const row = store.get("pecSternal", weekStartFor(MONDAY_NOON));
    expect(row!.totalVolume).toBeCloseTo(20 * 10 * 0.65 * 0.6); // pec share (.6) x sternal default split (.65)
    expect(row!.setCount).toBe(1);
  });

  it("cardio-only week produces valid shares that sum to 100%", () => {
    applySessionToRollup(store, {
      sets: [],
      bodyweightKg: 80,
      cardio: [{ modality: "run", durationMin: 30, intensityFactor: 1, timestampMs: MONDAY_NOON }],
    });
    const rows = store.getWeek(weekStartFor(MONDAY_NOON));
    expect(rows.length).toBeGreaterThan(0);
    const total = rows.reduce((sum, r) => sum + r.totalVolume, 0);
    const shareSum = rows.reduce((sum, r) => sum + r.totalVolume / total, 0);
    expect(shareSum).toBeCloseTo(1.0, 5);
  });

  it("cardio cap engages when a long session would otherwise dominate a muscle", () => {
    // Tiny lifting volume on quads, then a huge run.
    applySessionToRollup(store, {
      sets: [{ exerciseId: "leg-extension", weightKg: 20, reps: 5, timestamp: MONDAY_NOON }],
      bodyweightKg: 80,
    });
    const liftingRow = store.get("quads", weekStartFor(MONDAY_NOON))!;

    applySessionToRollup(store, {
      sets: [],
      bodyweightKg: 80,
      cardio: [{ modality: "run", durationMin: 300, intensityFactor: 3, timestampMs: MONDAY_NOON + 1000 }],
    });
    const afterCardio = store.get("quads", weekStartFor(MONDAY_NOON))!;

    const uncappedCardioContribution = 300 * 3 * 120 * 0.35; // duration x intensity x conversion x run's quad weight
    expect(afterCardio.cardioVolume).toBeLessThan(uncappedCardioContribution);
    expect(afterCardio.cardioVolume).toBeLessThanOrEqual(0.5 * Math.max(liftingRow.liftingVolume, 500) + 1e-9);
  });
});

describe("rollup integrity", () => {
  let store: InMemoryMuscleRollupStore;
  beforeEach(() => {
    store = new InMemoryMuscleRollupStore();
  });

  function sessionAt(ts: number, weightKg: number): HeatmapSessionInput {
    return { sets: [{ exerciseId: "barbell-bench-press", weightKg, reps: 10, timestamp: ts }], bodyweightKg: 80 };
  }

  it("session edit recomputes exactly one week, leaving other weeks untouched", () => {
    const weekStart = weekStartFor(MONDAY_NOON);
    const otherWeekStart = weekStartFor(MONDAY_NOON + 14 * DAY);

    applySessionToRollup(store, sessionAt(MONDAY_NOON, 40));
    applySessionToRollup(store, sessionAt(MONDAY_NOON + 14 * DAY, 40));

    const otherBefore = store.get("pecSternal", otherWeekStart)!.totalVolume;

    // "edit" the first session's weight from 40 to 60 by recomputing its week
    recomputeWeekRollup(store, weekStart, [sessionAt(MONDAY_NOON, 60)]);

    const edited = store.get("pecSternal", weekStart)!;
    expect(edited.totalVolume).toBeCloseTo(60 * 10 * 0.6 * 0.65);
    expect(store.get("pecSternal", otherWeekStart)!.totalVolume).toBe(otherBefore);
  });

  it("session delete decrements counts correctly", () => {
    const weekStart = weekStartFor(MONDAY_NOON);
    applySessionToRollup(store, sessionAt(MONDAY_NOON, 40));
    applySessionToRollup(store, sessionAt(MONDAY_NOON + DAY, 40));
    expect(store.get("pecSternal", weekStart)!.setCount).toBe(2);

    // "delete" the second session by recomputing with only the first
    recomputeWeekRollup(store, weekStart, [sessionAt(MONDAY_NOON, 40)]);
    expect(store.get("pecSternal", weekStart)!.setCount).toBe(1);
  });

  it("lastTrainedAt tracks the most recent session, even if an earlier session is applied second (e.g. a backfilled log entry)", () => {
    const weekStart = weekStartFor(MONDAY_NOON);
    applySessionToRollup(store, sessionAt(MONDAY_NOON + 2 * DAY, 40));
    applySessionToRollup(store, sessionAt(MONDAY_NOON, 40)); // applied later, but chronologically earlier

    expect(store.get("pecSternal", weekStart)!.lastTrainedAt).toBe(MONDAY_NOON + 2 * DAY);
  });

  it("a session spanning midnight lands entirely in one week bucket", () => {
    const sundayNight = Date.UTC(2026, 7, 9, 23, 58, 0); // Sunday, week before
    const mondayMorning = Date.UTC(2026, 7, 10, 0, 5, 0); // Monday, new week

    const session: HeatmapSessionInput = {
      sets: [
        { exerciseId: "barbell-bench-press", weightKg: 40, reps: 10, timestamp: sundayNight },
        { exerciseId: "barbell-bench-press", weightKg: 40, reps: 10, timestamp: mondayMorning },
      ],
      bodyweightKg: 80,
    };
    applySessionToRollup(store, session);

    const sundayWeek = weekStartFor(sundayNight);
    const mondayWeek = weekStartFor(mondayMorning);
    expect(sundayWeek).not.toBe(mondayWeek);

    // both sets counted in the SAME (session-start) week bucket
    expect(store.get("pecSternal", sundayWeek)!.setCount).toBe(2);
    expect(store.get("pecSternal", mondayWeek)).toBeUndefined();
  });
});
