import { describe, it, expect, beforeEach } from "vitest";
import { searchExercises } from "../src/domain/search.js";
import { createCompoundExercise, clearCompoundRegistry } from "../src/domain/compound.js";
import { EXERCISE_CATALOG } from "../src/domain/catalog.js";

beforeEach(() => {
  clearCompoundRegistry();
});

describe("searchExercises", () => {
  it("returns the whole library for an empty query", () => {
    expect(searchExercises("").length).toBe(EXERCISE_CATALOG.length);
  });

  it("finds all bench press variants by name", () => {
    const results = searchExercises("bench");
    const ids = results.map((e) => e.id);
    expect(ids).toContain("barbell-bench-press");
    expect(ids).toContain("dumbbell-bench-press");
    expect(ids).toContain("close-grip-bench-press");
  });

  it("ranks an exact name match first", () => {
    const results = searchExercises("push-up");
    expect(results[0]!.id).toBe("pushup");
  });

  it("finds an exercise by alias", () => {
    const results = searchExercises("press up");
    expect(results.some((e) => e.id === "pushup")).toBe(true);
  });

  it("returns nothing for a nonsense query", () => {
    expect(searchExercises("zzqxnotreal")).toEqual([]);
  });

  it("filters by muscle", () => {
    const results = searchExercises("", { muscle: "calves" });
    expect(results.length).toBeGreaterThan(0);
    for (const exercise of results) {
      expect(exercise.muscles.some((m) => m.muscle === "calves")).toBe(true);
    }
  });

  it("filters by equipment", () => {
    const results = searchExercises("", { equipment: "pull-up-bar" });
    expect(results.length).toBeGreaterThan(0);
    for (const exercise of results) {
      expect(exercise.equipment).toContain("pull-up-bar");
    }
  });

  it("filters by loadType", () => {
    const results = searchExercises("", { loadType: "time" });
    expect(results.length).toBeGreaterThan(0);
    for (const exercise of results) {
      expect(exercise.loadType).toBe("time");
    }
  });

  it("combines a text query with filters", () => {
    const results = searchExercises("squat", { loadType: "bodyweight" });
    for (const exercise of results) {
      expect(exercise.loadType).toBe("bodyweight");
      expect(exercise.name.toLowerCase()).toContain("squat");
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters a mixed-load-type compound by a non-first component's loadType", () => {
    // compound's own (advisory) loadType is "barbell" (first component),
    // but it genuinely contains a "time" component (side-plank) too.
    const compound = createCompoundExercise("row-plank-combo", "Row + Plank Combo", ["barbell-row", "side-plank"]);
    expect(compound.loadType).toBe("barbell");

    const timeResults = searchExercises("", { loadType: "time" });
    expect(timeResults.map((e) => e.id)).toContain("row-plank-combo");

    const barbellResults = searchExercises("", { loadType: "barbell" });
    expect(barbellResults.map((e) => e.id)).toContain("row-plank-combo");
  });

  it("includes newly created compound exercises once registered", () => {
    expect(searchExercises("thruster combo")).toEqual([]);
    createCompoundExercise("thruster-combo", "Thruster Combo", ["pushup", "bodyweight-squat"], {
      aliases: ["thruster"],
    });
    const results = searchExercises("thruster combo");
    expect(results.map((e) => e.id)).toContain("thruster-combo");
  });
});
