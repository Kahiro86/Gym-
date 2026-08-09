import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMuscleRollupStore, weekStartFor, addWeeks, applySessionToRollup } from "../../src/heatmap/store.js";
import { computeWeeklyMap, computeDiffView, computeRecencyMap } from "../../src/heatmap/views.js";
import { HEATMAP_MUSCLES } from "../../src/heatmap/registry.js";
import type { HeatmapSessionInput } from "../../src/heatmap/store.js";

const MONDAY_NOON = Date.UTC(2026, 7, 10, 12, 0, 0);

function benchSession(ts: number, weightKg: number): HeatmapSessionInput {
  return { sets: [{ exerciseId: "barbell-bench-press", weightKg, reps: 10, timestamp: ts }], bodyweightKg: 80 };
}
function squatSession(ts: number, weightKg: number): HeatmapSessionInput {
  return { sets: [{ exerciseId: "back-squat", weightKg, reps: 5, timestamp: ts }], bodyweightKg: 80 };
}

describe("computeWeeklyMap — cold start", () => {
  it("an empty store produces a valid, error-free map with all-zero shares", () => {
    const store = new InMemoryMuscleRollupStore();
    const map = computeWeeklyMap(store, weekStartFor(MONDAY_NOON));
    expect(map.totalVolume).toBe(0);
    for (const m of map.muscles) expect(m.share).toBe(0);
  });

  it("the first logged session produces a valid weekly map (correct on week one, no history required)", () => {
    const store = new InMemoryMuscleRollupStore();
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));
    const map = computeWeeklyMap(store, weekStartFor(MONDAY_NOON));
    expect(map.totalVolume).toBeGreaterThan(0);
    const shareSum = map.muscles.reduce((sum, m) => sum + m.share, 0);
    expect(shareSum).toBeCloseTo(1.0, 5);
  });
});

describe("computeWeeklyMap — aggregation", () => {
  let store: InMemoryMuscleRollupStore;
  const weekStart = weekStartFor(MONDAY_NOON);

  beforeEach(() => {
    store = new InMemoryMuscleRollupStore();
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));
    applySessionToRollup(store, squatSession(MONDAY_NOON + 1000, 80));
  });

  it("group percentage equals the sum of child percentages", () => {
    const map = computeWeeklyMap(store, weekStart);
    for (const group of map.groups) {
      const children = map.muscles.filter((m) => HEATMAP_MUSCLES.find((h) => h.id === m.muscleId)!.groupId === group.groupId);
      const expectedPercentage = children.reduce((sum, c) => sum + c.share, 0);
      expect(group.percentage, group.groupId).toBeCloseTo(expectedPercentage, 5);
    }
  });

  it("group color is the volume-weighted mean of children, not the max (one hot lateral delt doesn't paint the whole shoulder)", () => {
    const store2 = new InMemoryMuscleRollupStore();
    // Only lateral raise this week: heavy on deltLateral, ~nothing on anterior/posterior.
    applySessionToRollup(store2, {
      sets: [{ exerciseId: "lateral-raise", weightKg: 8, reps: 12, timestamp: MONDAY_NOON }],
      bodyweightKg: 80,
    });
    const map = computeWeeklyMap(store2, weekStart);
    const shoulders = map.groups.find((g) => g.groupId === "shoulders")!;
    const lateral = map.muscles.find((m) => m.muscleId === "deltLateral")!;

    // color must be a weighted mean (<= the max child share), never equal to
    // the single hot muscle's share when other children exist at 0.
    expect(shoulders.color).toBeLessThan(lateral.share);
    expect(shoulders.color).toBeGreaterThan(0);
  });

  it("the full weekly map is correct on the user's first week (no trailing history read)", () => {
    // computeWeeklyMap never reads any week other than the one requested.
    const map = computeWeeklyMap(store, weekStart);
    expect(map.totalVolume).toBeGreaterThan(0);
  });
});

describe("computeDiffView", () => {
  it("a lighter week with identical composition yields all-zero deltas", () => {
    const store = new InMemoryMuscleRollupStore();
    const weekA = weekStartFor(MONDAY_NOON);
    const weekB = addWeeks(weekA, 1);

    applySessionToRollup(store, benchSession(MONDAY_NOON, 100));
    applySessionToRollup(store, squatSession(MONDAY_NOON + 1000, 100));

    const scaleDown = 0.5;
    applySessionToRollup(store, benchSession(MONDAY_NOON + 7 * 86_400_000, 100 * scaleDown));
    applySessionToRollup(store, squatSession(MONDAY_NOON + 7 * 86_400_000 + 1000, 100 * scaleDown));

    const diff = computeDiffView(store, weekA, weekB);
    expect(diff.totalVolumeB).toBeLessThan(diff.totalVolumeA);
    for (const m of diff.muscles) {
      expect(m.deltaShare, m.muscleId).toBeCloseTo(0, 5);
    }
  });

  it("deltas across a full week sum to approximately zero", () => {
    const store = new InMemoryMuscleRollupStore();
    const weekA = weekStartFor(MONDAY_NOON);
    const weekB = addWeeks(weekA, 1);

    applySessionToRollup(store, benchSession(MONDAY_NOON, 100));
    applySessionToRollup(store, squatSession(MONDAY_NOON + 7 * 86_400_000, 40));

    const diff = computeDiffView(store, weekA, weekB);
    const deltaSum = diff.muscles.reduce((sum, m) => sum + m.deltaShare, 0);
    expect(deltaSum).toBeCloseTo(0, 5);
  });

  it("reports both weeks' absolute volumes plus both deltas", () => {
    const store = new InMemoryMuscleRollupStore();
    const weekA = weekStartFor(MONDAY_NOON);
    const weekB = addWeeks(weekA, 1);
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));

    const diff = computeDiffView(store, weekA, weekB);
    const pecSternal = diff.muscles.find((m) => m.muscleId === "pecSternal")!;
    expect(pecSternal.volumeA).toBeGreaterThan(0);
    expect(pecSternal.volumeB).toBe(0);
    expect(pecSternal.deltaVolume).toBe(pecSternal.volumeB - pecSternal.volumeA);
  });
});

describe("computeRecencyMap — normalization", () => {
  it("a single set on a never-trained muscle does not reach full heat (the floor engages)", () => {
    const store = new InMemoryMuscleRollupStore();
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));

    const recency = computeRecencyMap(store, MONDAY_NOON + 1000);
    const pecSternal = recency.find((r) => r.muscleId === "pecSternal")!;

    // trailing average is ~0 (no history), so the floor dominates the
    // denominator — a single set must not saturate heat to 1.
    expect(pecSternal.heat).toBeLessThan(1);
    expect(pecSternal.heat).toBeGreaterThan(0);
  });

  it("trailing average with fewer than 8 weeks of history degrades gracefully (no crash, no NaN)", () => {
    const store = new InMemoryMuscleRollupStore();
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));
    applySessionToRollup(store, benchSession(MONDAY_NOON - 7 * 86_400_000, 60));
    // only 2 weeks of history exist, far short of the 8-week trailing window

    const recency = computeRecencyMap(store, MONDAY_NOON + 1000);
    for (const entry of recency) {
      expect(Number.isNaN(entry.heat), entry.muscleId).toBe(false);
      expect(entry.heat).toBeGreaterThanOrEqual(0);
      expect(entry.heat).toBeLessThanOrEqual(1);
    }
  });

  it("changing tau_days alters recency output immediately, with no backfill", () => {
    const store = new InMemoryMuscleRollupStore();
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));
    const nowMs = MONDAY_NOON + 2 * 86_400_000; // 2 days later

    const muscle = HEATMAP_MUSCLES.find((m) => m.id === "pecSternal")!;
    const originalTau = muscle.tauDays;

    const before = computeRecencyMap(store, nowMs).find((r) => r.muscleId === "pecSternal")!;
    let after;
    try {
      muscle.tauDays = 1.0; // simulate a tuning change — no stored row is touched
      after = computeRecencyMap(store, nowMs).find((r) => r.muscleId === "pecSternal")!;
    } finally {
      muscle.tauDays = originalTau;
    }

    expect(after.freshness).toBeLessThan(before.freshness); // faster decay -> less freshness after 2 days
  });

  it("decays to less freshness the longer ago a muscle was trained", () => {
    const store = new InMemoryMuscleRollupStore();
    applySessionToRollup(store, benchSession(MONDAY_NOON, 60));

    const soon = computeRecencyMap(store, MONDAY_NOON + 1000).find((r) => r.muscleId === "pecSternal")!;
    const later = computeRecencyMap(store, MONDAY_NOON + 5 * 86_400_000).find((r) => r.muscleId === "pecSternal")!;
    expect(later.freshness).toBeLessThan(soon.freshness);
  });
});
