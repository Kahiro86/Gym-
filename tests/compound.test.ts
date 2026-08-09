import { describe, it, expect, beforeEach } from "vitest";
import { createCompoundExercise, getCompoundExercise, listCompoundExercises, clearCompoundRegistry } from "../src/domain/compound.js";
import { requireExercise } from "../src/domain/registry.js";
import { computeSessionXp } from "../src/domain/xp.js";
import { emptyExerciseHistory, MUSCLE_IDS } from "../src/domain/types.js";
import type { HistoryContext, SessionInput } from "../src/domain/types.js";

beforeEach(() => {
  clearCompoundRegistry();
});

describe("createCompoundExercise", () => {
  it("requires at least 2 components", () => {
    expect(() => createCompoundExercise("solo", "Solo", ["pushup"])).toThrow(/at least 2/);
  });

  it("rejects duplicate components", () => {
    expect(() => createCompoundExercise("dupe", "Dupe", ["pushup", "pushup"])).toThrow(/repeat/);
  });

  it("rejects an unknown component id", () => {
    expect(() => createCompoundExercise("bad", "Bad", ["pushup", "not-a-real-exercise"])).toThrow(/Unknown component/);
  });

  it("rejects mismatched load types", () => {
    expect(() => createCompoundExercise("mixed", "Mixed", ["pushup", "barbell-bench-press"])).toThrow(
      /same load type/
    );
  });

  it("rejects an id that's already taken by the seed catalog", () => {
    expect(() => createCompoundExercise("pushup", "Pushup Combo", ["pull-up", "bodyweight-squat"])).toThrow(
      /already taken/
    );
  });

  it("rejects an id that's already taken by another compound", () => {
    createCompoundExercise("combo-a", "Combo A", ["pushup", "bodyweight-squat"]);
    expect(() => createCompoundExercise("combo-a", "Combo A Again", ["pull-up", "dip"])).toThrow(/already taken/);
  });

  it("blends muscle contributions into shares that still sum to 1.0", () => {
    const compound = createCompoundExercise("squat-thrust", "Squat Thrust", ["pushup", "bodyweight-squat"]);
    const total = compound.muscles.reduce((sum, m) => sum + m.share, 0);
    expect(total).toBeCloseTo(1.0, 5);

    // every muscle either component trains should show up
    const muscleSet = new Set(compound.muscles.map((m) => m.muscle));
    expect(muscleSet.has("chest")).toBe(true);
    expect(muscleSet.has("quads")).toBe(true);
  });

  it("sums referenceVolume and leverageFactor across bodyweight components", () => {
    const pushup = requireExercise("pushup");
    const squat = requireExercise("bodyweight-squat");
    const compound = createCompoundExercise("squat-thrust-2", "Squat Thrust 2", ["pushup", "bodyweight-squat"]);

    expect(compound.referenceVolume).toBe(pushup.referenceVolume + squat.referenceVolume);
    expect(compound.leverageFactor).toBeCloseTo(pushup.leverageFactor! + squat.leverageFactor!);
    expect(compound.loadType).toBe("bodyweight");
  });

  it("is unilateral if any component is unilateral", () => {
    const compound = createCompoundExercise("archer-lunge", "Archer Lunge Combo", ["archer-pushup", "reverse-lunge"]);
    expect(compound.unilateral).toBe(true);
  });

  it("weights muscle blending by emphasis when provided", () => {
    const evenWeight = createCompoundExercise("even", "Even", ["pushup", "bodyweight-squat"]);
    const heavyOnSquat = createCompoundExercise("heavy-squat", "Heavy Squat", [
      { exerciseId: "pushup", emphasis: 1 },
      { exerciseId: "bodyweight-squat", emphasis: 3 },
    ]);

    const evenQuads = evenWeight.muscles.find((m) => m.muscle === "quads")!.share;
    const heavyQuads = heavyOnSquat.muscles.find((m) => m.muscle === "quads")!.share;
    expect(heavyQuads).toBeGreaterThan(evenQuads);
  });

  it("is registered and retrievable, and shows up in listCompoundExercises", () => {
    const compound = createCompoundExercise("combo-b", "Combo B", ["pushup", "bodyweight-squat"]);
    expect(getCompoundExercise("combo-b")).toEqual(compound);
    expect(listCompoundExercises().map((e) => e.id)).toContain("combo-b");
  });

  it("resolves through the unified registry alongside seed exercises", () => {
    createCompoundExercise("combo-c", "Combo C", ["pushup", "bodyweight-squat"]);
    expect(requireExercise("combo-c").name).toBe("Combo C");
  });
});

describe("compound exercises in a real session", () => {
  it("computes XP and attributes muscleXp across every component's muscles", () => {
    const compound = createCompoundExercise("burpee-complex", "Burpee Complex", [
      "pushup",
      "bodyweight-squat",
    ]);

    const history: HistoryContext = {
      exerciseHistory: { [compound.id]: emptyExerciseHistory() },
      isFirstSessionOfDay: true,
      completesWeeklyTarget: false,
      streakWeeks: 0,
    };

    const session: SessionInput = {
      sets: [{ exerciseId: compound.id, reps: 10, timestamp: 0 }],
      bodyweightKg: 80,
      history,
    };

    const result = computeSessionXp(session);
    expect(result.total).toBeGreaterThan(0);
    expect(Number.isNaN(result.total)).toBe(false);

    for (const muscle of ["chest", "triceps", "shoulders", "quads", "glutes", "hamstrings", "abductors"]) {
      expect(result.muscleXp[muscle as (typeof MUSCLE_IDS)[number]]).toBeGreaterThan(0);
    }
  });
});
