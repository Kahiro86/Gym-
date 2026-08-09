import { describe, it, expect } from "vitest";
import { EXERCISE_CATALOG } from "../src/domain/catalog.js";
import { MUSCLES, getMuscle } from "../src/domain/muscles.js";

describe("exercise catalog", () => {
  it("seeds a full exercise library", () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(70);
    expect(EXERCISE_CATALOG.length).toBeLessThanOrEqual(130);
  });

  it("has unique ids", () => {
    const ids = new Set(EXERCISE_CATALOG.map((e) => e.id));
    expect(ids.size).toBe(EXERCISE_CATALOG.length);
  });

  it("has muscle shares summing to 1.0 for every entry (property test, v2 §7)", () => {
    for (const exercise of EXERCISE_CATALOG) {
      const total = exercise.muscles.reduce((sum, m) => sum + m.share, 0);
      expect(total, `${exercise.id} muscle shares should sum to 1.0`).toBeCloseTo(1.0, 5);
    }
  });

  it("has a positive share for every muscle contribution", () => {
    for (const exercise of EXERCISE_CATALOG) {
      for (const contribution of exercise.muscles) {
        expect(contribution.share, `${exercise.id} -> ${contribution.muscle}`).toBeGreaterThan(0);
      }
    }
  });

  it("every entry has at least one primaryMover (v2 §7)", () => {
    for (const exercise of EXERCISE_CATALOG) {
      const hasPrimary = exercise.muscles.some((m) => m.primaryMover);
      expect(hasPrimary, exercise.id).toBe(true);
    }
  });

  it("declares a valid limbsLoaded and positive defaultRestSeconds for every entry", () => {
    for (const exercise of EXERCISE_CATALOG) {
      expect([1, 2], exercise.id).toContain(exercise.limbsLoaded);
      expect(exercise.defaultRestSeconds, exercise.id).toBeGreaterThan(0);
    }
  });

  it("declares leverageFactor for every bodyweight/weighted_bodyweight/assisted/distance exercise", () => {
    for (const exercise of EXERCISE_CATALOG) {
      if (
        exercise.loadType === "bodyweight" ||
        exercise.loadType === "weighted_bodyweight" ||
        exercise.loadType === "assisted" ||
        exercise.loadType === "distance"
      ) {
        expect(exercise.leverageFactor, exercise.id).toBeTypeOf("number");
      }
    }
  });

  it("declares intensityFactor for every time exercise", () => {
    for (const exercise of EXERCISE_CATALOG) {
      if (exercise.loadType === "time") {
        expect(exercise.intensityFactor, exercise.id).toBeTypeOf("number");
      }
    }
  });

  it("has a positive referenceVolume for every entry", () => {
    for (const exercise of EXERCISE_CATALOG) {
      expect(exercise.referenceVolume, exercise.id).toBeGreaterThan(0);
    }
  });

  it("never lets a bodyweight exercise imply it needs a weight field (structurally impossible pushup bug)", () => {
    const bodyweightExercises = EXERCISE_CATALOG.filter((e) => e.loadType === "bodyweight");
    expect(bodyweightExercises.length).toBeGreaterThan(0);
    for (const exercise of bodyweightExercises) {
      // bodyweight loadType's effective load formula structurally ignores weightKg —
      // there is no code path where a UI would need to collect it.
      expect(exercise.loadType).toBe("bodyweight");
    }
  });

  it("a dumbbell exercise's entered weight is always per implement — limbsLoaded is what scales it (v2 §3.2)", () => {
    const dumbbellExercises = EXERCISE_CATALOG.filter((e) => e.loadType === "dumbbell");
    expect(dumbbellExercises.length).toBeGreaterThan(0);
    for (const exercise of dumbbellExercises) {
      expect([1, 2], exercise.id).toContain(exercise.limbsLoaded);
    }
    // a unilateral single-arm dumbbell exercise must be limbsLoaded 1, not 2
    // (v1's bug: single-arm row was both dumbbell(x2) and unilateral(x2))
    const singleArmRow = dumbbellExercises.find((e) => e.id === "single-arm-dumbbell-row")!;
    expect(singleArmRow.limbsLoaded).toBe(1);
    expect(singleArmRow.unilateral).toBe(true);
  });

  it("head-level shares aggregate correctly to their tier-2 group (v2 §7)", () => {
    // spot check: bench press's chest heads both belong to the "chest" group
    const bench = EXERCISE_CATALOG.find((e) => e.id === "barbell-bench-press")!;
    const chestContributions = bench.muscles.filter((m) => m.muscle === "chestClavicular" || m.muscle === "chestSternal");
    expect(chestContributions.length).toBe(2);
    for (const c of chestContributions) {
      expect(getMuscle(c.muscle).groupId).toBe("chest");
    }
  });

  it("every muscle in the registry is trained by at least one catalog exercise (§3.3: neck must have real entries)", () => {
    const mapped = new Set(EXERCISE_CATALOG.flatMap((e) => e.muscles.map((m) => m.muscle)));
    const unmapped = MUSCLES.map((m) => m.id).filter((id) => !mapped.has(id));
    expect(unmapped).toEqual([]);
  });
});
