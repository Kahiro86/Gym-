import { describe, it, expect } from "vitest";
import { computeHeatmapContributions } from "../../src/heatmap/muscleWeights.js";
import { findUnmappedMuscles } from "../../src/heatmap/views.js";
import { EXERCISE_CATALOG } from "../../src/domain/catalog.js";
import { requireExercise } from "../../src/domain/registry.js";
import { createCompoundExercise, clearCompoundRegistry } from "../../src/domain/compound.js";

describe("computeHeatmapContributions", () => {
  it("re-splits every catalog exercise's weights to sum back to 1.0", () => {
    for (const exercise of EXERCISE_CATALOG) {
      const total = computeHeatmapContributions(exercise).reduce((sum, c) => sum + c.weight, 0);
      expect(total, exercise.id).toBeCloseTo(1.0, 5);
    }
  });

  it("marks anterior delt as trained (primary) on overhead press, while lateral/posterior still accumulate a real but lower share", () => {
    const press = requireExercise("overhead-press");
    const contributions = computeHeatmapContributions(press);

    const anterior = contributions.find((c) => c.muscle === "deltAnterior")!;
    const lateral = contributions.find((c) => c.muscle === "deltLateral")!;
    const posterior = contributions.find((c) => c.muscle === "deltPosterior")!;

    expect(anterior.primary).toBe(true);
    expect(anterior.weight).toBeGreaterThan(lateral.weight);
    expect(lateral.weight).toBeGreaterThan(0);
    expect(posterior.weight).toBeGreaterThan(0);
  });

  it("gives incline presses a clavicular-dominant split and decline presses a sternal-dominant split", () => {
    const incline = computeHeatmapContributions(requireExercise("incline-barbell-bench-press"));
    const decline = computeHeatmapContributions(requireExercise("decline-barbell-bench-press"));

    const inclineClav = incline.find((c) => c.muscle === "pecClavicular")!.weight;
    const inclineSternal = incline.find((c) => c.muscle === "pecSternal")!.weight;
    const declineClav = decline.find((c) => c.muscle === "pecClavicular")!.weight;
    const declineSternal = decline.find((c) => c.muscle === "pecSternal")!.weight;

    expect(inclineClav).toBeGreaterThan(inclineSternal);
    expect(declineSternal).toBeGreaterThan(declineClav);
  });

  it("gives rows a posterior-delt-dominant split, opposite of horizontal presses", () => {
    const row = computeHeatmapContributions(requireExercise("barbell-row"));
    const bench = computeHeatmapContributions(requireExercise("barbell-bench-press"));

    const rowPosterior = row.find((c) => c.muscle === "deltPosterior")!.weight;
    const rowAnterior = row.find((c) => c.muscle === "deltAnterior")!.weight;
    const benchAnterior = bench.find((c) => c.muscle === "deltAnterior")!.weight;
    const benchPosterior = bench.find((c) => c.muscle === "deltPosterior")!.weight;

    expect(rowPosterior).toBeGreaterThan(rowAnterior);
    expect(benchAnterior).toBeGreaterThan(benchPosterior);
  });

  it("passes atomic muscles (quads, glutes, back, ...) straight through unsplit", () => {
    const squat = computeHeatmapContributions(requireExercise("back-squat"));
    expect(squat.find((c) => c.muscle === "quads")).toBeDefined();
    expect(squat.find((c) => c.muscle === "glutes")).toBeDefined();
  });

  it("blends compound exercises from their components", () => {
    clearCompoundRegistry();
    const compound = createCompoundExercise("ohp-row-combo", "OHP + Row", ["overhead-press", "barbell-row"]);
    const contributions = computeHeatmapContributions(compound);
    const total = contributions.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1.0, 5);

    // anterior delt (from OHP) and posterior delt (from the row) should both show up
    expect(contributions.find((c) => c.muscle === "deltAnterior")!.weight).toBeGreaterThan(0);
    expect(contributions.find((c) => c.muscle === "deltPosterior")!.weight).toBeGreaterThan(0);
    clearCompoundRegistry();
  });

  it("registry authoring integrity: no tier-1 muscle is left permanently unmapped by the real catalog (§8)", () => {
    const allWeights = EXERCISE_CATALOG.map((exercise) => computeHeatmapContributions(exercise));
    expect(findUnmappedMuscles(allWeights)).toEqual([]);
  });
});
