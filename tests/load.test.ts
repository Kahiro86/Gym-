import { describe, it, expect } from "vitest";
import { resolveEffectiveLoad, computeSetVolume } from "../src/domain/load.js";
import type { Exercise, LoggedSet } from "../src/domain/types.js";

const BW = 80;

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return { exerciseId: "test", timestamp: 0, ...overrides };
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "test",
    name: "Test",
    aliases: [],
    loadType: "barbell",
    muscles: [{ muscle: "chest", share: 1 }],
    equipment: ["barbell"],
    unilateral: false,
    referenceVolume: 100,
    ...overrides,
  };
}

describe("resolveEffectiveLoad", () => {
  it("barbell/machine/cable use the entered weight directly", () => {
    for (const loadType of ["barbell", "machine", "cable"] as const) {
      const ex = exercise({ loadType });
      expect(resolveEffectiveLoad(ex, set({ weightKg: 60 }), BW)).toBe(60);
    }
  });

  it("dumbbell doubles the entered weight", () => {
    const ex = exercise({ loadType: "dumbbell" });
    expect(resolveEffectiveLoad(ex, set({ weightKg: 20 }), BW)).toBe(40);
  });

  it("bodyweight uses bodyweight x leverage and ignores any entered weight", () => {
    const ex = exercise({ loadType: "bodyweight", leverageFactor: 0.64 });
    expect(resolveEffectiveLoad(ex, set(), BW)).toBeCloseTo(51.2);
    expect(resolveEffectiveLoad(ex, set({ weightKg: 999 }), BW)).toBeCloseTo(51.2);
  });

  it("weighted_bodyweight adds the entered weight on top of leveraged bodyweight", () => {
    const ex = exercise({ loadType: "weighted_bodyweight", leverageFactor: 0.95 });
    expect(resolveEffectiveLoad(ex, set({ weightKg: 20 }), BW)).toBeCloseTo(80 * 0.95 + 20);
  });

  it("assisted subtracts assistance from leveraged bodyweight, floored at 0", () => {
    const ex = exercise({ loadType: "assisted", leverageFactor: 1.0 });
    expect(resolveEffectiveLoad(ex, set({ weightKg: 30 }), BW)).toBeCloseTo(50);
    expect(resolveEffectiveLoad(ex, set({ weightKg: 999 }), BW)).toBe(0);
  });

  it("time uses the load-free intensity factor", () => {
    const ex = exercise({ loadType: "time", intensityFactor: 5 });
    expect(resolveEffectiveLoad(ex, set({ durationSec: 60 }), BW)).toBe(5);
  });

  it("distance uses bodyweight x factor", () => {
    const ex = exercise({ loadType: "distance", intensityFactor: 0.5 });
    expect(resolveEffectiveLoad(ex, set({ distanceM: 40 }), BW)).toBe(40);
  });

  it("throws a clear error rather than silently producing NaN when leverage/intensity is missing", () => {
    const ex = exercise({ loadType: "bodyweight" });
    expect(() => resolveEffectiveLoad(ex, set(), BW)).toThrow();
  });
});

describe("computeSetVolume", () => {
  it("is load x reps for a standard weighted exercise", () => {
    const ex = exercise({ loadType: "barbell", referenceVolume: 100 });
    expect(computeSetVolume(ex, set({ weightKg: 50, reps: 10 }), BW)).toBe(500);
  });

  it("bodyweight exercises never require a weight input to produce volume", () => {
    const ex = exercise({ loadType: "bodyweight", leverageFactor: 0.64 });
    const volume = computeSetVolume(ex, set({ reps: 5 }), BW);
    expect(volume).toBeCloseTo(256); // 80 * 0.64 * 5, matches spec §4.5 worked example
  });

  it("doubles total reps for unilateral exercises (reps are logged per side)", () => {
    const bilateral = exercise({ loadType: "barbell", unilateral: false });
    const unilateral = exercise({ loadType: "barbell", unilateral: true });
    const bilateralVolume = computeSetVolume(bilateral, set({ weightKg: 20, reps: 10 }), BW);
    const unilateralVolume = computeSetVolume(unilateral, set({ weightKg: 20, reps: 10 }), BW);
    expect(unilateralVolume).toBe(bilateralVolume * 2);
  });

  it("time-based volume is intensity x duration", () => {
    const ex = exercise({ loadType: "time", intensityFactor: 5 });
    expect(computeSetVolume(ex, set({ durationSec: 60 }), BW)).toBe(300);
  });

  it("distance-based volume is effective load x distance", () => {
    const ex = exercise({ loadType: "distance", intensityFactor: 0.5 });
    expect(computeSetVolume(ex, set({ distanceM: 40 }), BW)).toBe(1600);
  });

  it("never produces a negative volume even for an overassisted set", () => {
    const ex = exercise({ loadType: "assisted", leverageFactor: 1.0 });
    const volume = computeSetVolume(ex, set({ weightKg: 999, reps: 10 }), BW);
    expect(volume).toBe(0);
  });
});
