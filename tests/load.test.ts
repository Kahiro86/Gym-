import { describe, it, expect } from "vitest";
import { resolveEffectiveLoad, computeSetVolume, DISTANCE_SCALE } from "../src/domain/load.js";
import type { Exercise, LoggedSet } from "../src/domain/types.js";

const BW = 80;

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return { exerciseId: "test", bodyweightKg: BW, timestamp: 0, ...overrides };
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "test",
    name: "Test",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "chestSternal", share: 1, primaryMover: true }],
    equipment: ["barbell"],
    referenceVolume: 100,
    defaultRestSeconds: 120,
    ...overrides,
  };
}

describe("resolveEffectiveLoad", () => {
  it("barbell/machine/cable use the entered weight directly", () => {
    for (const loadType of ["barbell", "machine", "cable"] as const) {
      const ex = exercise({ loadType });
      expect(resolveEffectiveLoad(ex, set({ weightKg: 60 }))).toBe(60);
    }
  });

  it("dumbbell scales entered weight by limbsLoaded, not an implicit x2 (v2 §3.2)", () => {
    const bilateral = exercise({ loadType: "dumbbell", limbsLoaded: 2 });
    const unilateral = exercise({ loadType: "dumbbell", limbsLoaded: 1 });
    expect(resolveEffectiveLoad(bilateral, set({ weightKg: 20 }))).toBe(40);
    expect(resolveEffectiveLoad(unilateral, set({ weightKg: 20 }))).toBe(20);
  });

  it("a single-arm dumbbell row (limbsLoaded 1, unilateral) is not double-doubled", () => {
    const singleArmRow = exercise({ loadType: "dumbbell", limbsLoaded: 1, unilateral: true });
    // entered weight is per implement (v2 §3.2) — one 20kg dumbbell stays 20kg of load
    expect(resolveEffectiveLoad(singleArmRow, set({ weightKg: 20 }))).toBe(20);
  });

  it("bodyweight uses bodyweight x leverage and ignores any entered weight", () => {
    const ex = exercise({ loadType: "bodyweight", leverageFactor: 0.64 });
    expect(resolveEffectiveLoad(ex, set())).toBeCloseTo(51.2);
    expect(resolveEffectiveLoad(ex, set({ weightKg: 999 }))).toBeCloseTo(51.2);
  });

  it("uses the bodyweightKg snapshotted on the set, not a global value", () => {
    const ex = exercise({ loadType: "bodyweight", leverageFactor: 0.5 });
    expect(resolveEffectiveLoad(ex, set({ bodyweightKg: 100 }))).toBe(50);
    expect(resolveEffectiveLoad(ex, set({ bodyweightKg: 60 }))).toBe(30);
  });

  it("weighted_bodyweight adds the entered weight on top of leveraged bodyweight", () => {
    const ex = exercise({ loadType: "weighted_bodyweight", leverageFactor: 0.95 });
    expect(resolveEffectiveLoad(ex, set({ weightKg: 20 }))).toBeCloseTo(80 * 0.95 + 20);
  });

  it("assisted subtracts assistance from leveraged bodyweight, floored at 0", () => {
    const ex = exercise({ loadType: "assisted", leverageFactor: 1.0 });
    expect(resolveEffectiveLoad(ex, set({ weightKg: 30 }))).toBeCloseTo(50);
    expect(resolveEffectiveLoad(ex, set({ weightKg: 999 }))).toBe(0);
  });

  it("time uses the load-free intensity factor", () => {
    const ex = exercise({ loadType: "time", intensityFactor: 5 });
    expect(resolveEffectiveLoad(ex, set({ durationSec: 60 }))).toBe(5);
  });

  it("distance uses bodyweight x leverage, like bodyweight (v2 §3.1 correction)", () => {
    const ex = exercise({ loadType: "distance", leverageFactor: 0.5 });
    expect(resolveEffectiveLoad(ex, set({ distanceM: 40 }))).toBe(40);
  });

  it("throws a clear error rather than silently producing NaN when leverage/intensity is missing", () => {
    const ex = exercise({ loadType: "bodyweight" });
    expect(() => resolveEffectiveLoad(ex, set())).toThrow();
  });
});

describe("computeSetVolume", () => {
  it("is load x reps for a standard weighted exercise", () => {
    const ex = exercise({ loadType: "barbell", referenceVolume: 100 });
    expect(computeSetVolume(ex, set({ weightKg: 50, reps: 10 }))).toBe(500);
  });

  it("bodyweight exercises never require a weight input to produce volume (regression: the pushup bug)", () => {
    const ex = exercise({ loadType: "bodyweight", leverageFactor: 0.64 });
    const volume = computeSetVolume(ex, set({ reps: 5 }));
    expect(volume).toBeCloseTo(256); // 80 * 0.64 * 5
  });

  it("doubles total reps for unilateral exercises (reps are logged per side)", () => {
    const bilateral = exercise({ loadType: "barbell", unilateral: false });
    const unilateral = exercise({ loadType: "barbell", unilateral: true });
    const bilateralVolume = computeSetVolume(bilateral, set({ weightKg: 20, reps: 10 }));
    const unilateralVolume = computeSetVolume(unilateral, set({ weightKg: 20, reps: 10 }));
    expect(unilateralVolume).toBe(bilateralVolume * 2);
  });

  it("time-based volume is intensity x duration", () => {
    const ex = exercise({ loadType: "time", intensityFactor: 5 });
    expect(computeSetVolume(ex, set({ durationSec: 60 }))).toBe(300);
  });

  it("distance-based volume is finite, positive, and scaled by DISTANCE_SCALE (v2 §3.6)", () => {
    const ex = exercise({ loadType: "distance", leverageFactor: 0.5 });
    const volume = computeSetVolume(ex, set({ distanceM: 40 }));
    // effectiveLoad(40) x distanceM(40) x DISTANCE_SCALE
    expect(volume).toBeCloseTo(40 * 40 * DISTANCE_SCALE);
    expect(Number.isFinite(volume)).toBe(true);
    expect(volume).toBeGreaterThan(0);
  });

  it("doubles duration for a unilateral time-based exercise (e.g. side plank held per side)", () => {
    const bilateral = exercise({ loadType: "time", intensityFactor: 4, unilateral: false });
    const unilateral = exercise({ loadType: "time", intensityFactor: 4, unilateral: true });
    const bilateralVolume = computeSetVolume(bilateral, set({ durationSec: 30 }));
    const unilateralVolume = computeSetVolume(unilateral, set({ durationSec: 30 }));
    expect(unilateralVolume).toBe(bilateralVolume * 2);
  });

  it("doubles distance for a unilateral distance-based exercise", () => {
    const bilateral = exercise({ loadType: "distance", leverageFactor: 0.5, unilateral: false });
    const unilateral = exercise({ loadType: "distance", leverageFactor: 0.5, unilateral: true });
    const bilateralVolume = computeSetVolume(bilateral, set({ distanceM: 20 }));
    const unilateralVolume = computeSetVolume(unilateral, set({ distanceM: 20 }));
    expect(unilateralVolume).toBe(bilateralVolume * 2);
  });

  it("never produces a negative volume even for an overassisted set", () => {
    const ex = exercise({ loadType: "assisted", leverageFactor: 1.0 });
    const volume = computeSetVolume(ex, set({ weightKg: 999, reps: 10 }));
    expect(volume).toBe(0);
  });
});
