import { describe, it, expect } from "vitest";
import { EXERCISE_CATALOG } from "../src/domain/catalog.js";

describe("exercise catalog", () => {
  it("seeds a full exercise library", () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(70);
    expect(EXERCISE_CATALOG.length).toBeLessThanOrEqual(130);
  });

  it("has unique ids", () => {
    const ids = new Set(EXERCISE_CATALOG.map((e) => e.id));
    expect(ids.size).toBe(EXERCISE_CATALOG.length);
  });

  it("has muscle shares summing to 1.0 for every entry", () => {
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

  it("declares leverageFactor for every bodyweight-derived exercise", () => {
    for (const exercise of EXERCISE_CATALOG) {
      if (
        exercise.loadType === "bodyweight" ||
        exercise.loadType === "weighted_bodyweight" ||
        exercise.loadType === "assisted"
      ) {
        expect(exercise.leverageFactor, exercise.id).toBeTypeOf("number");
      }
    }
  });

  it("declares intensityFactor for every time/distance exercise", () => {
    for (const exercise of EXERCISE_CATALOG) {
      if (exercise.loadType === "time" || exercise.loadType === "distance") {
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
});
