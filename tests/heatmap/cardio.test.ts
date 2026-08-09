import { describe, it, expect } from "vitest";
import { computeCardioMuscleVolume, CARDIO_MODALITY_MAP, CARDIO_CONVERSION } from "../../src/heatmap/cardio.js";
import type { CardioModality } from "../../src/heatmap/cardio.js";

describe("cardio modality weights", () => {
  it("every modality's muscle weights sum to 1.0", () => {
    const modalities = new Set(CARDIO_MODALITY_MAP.map((w) => w.modality));
    for (const modality of modalities) {
      const total = CARDIO_MODALITY_MAP.filter((w) => w.modality === modality).reduce((sum, w) => sum + w.weight, 0);
      expect(total, modality).toBeCloseTo(1.0, 5);
    }
  });

  it("every modality has a conversion constant", () => {
    const modalities = new Set(CARDIO_MODALITY_MAP.map((w) => w.modality));
    for (const modality of modalities) {
      expect(CARDIO_CONVERSION.some((c) => c.modality === modality), modality).toBe(true);
    }
  });
});

describe("computeCardioMuscleVolume", () => {
  it("scales linearly with duration and intensity", () => {
    const base = computeCardioMuscleVolume({ modality: "run", durationMin: 30, intensityFactor: 1, timestampMs: 0 });
    const doubled = computeCardioMuscleVolume({ modality: "run", durationMin: 60, intensityFactor: 1, timestampMs: 0 });
    expect(doubled.quads).toBeCloseTo(base.quads! * 2);
  });

  it("throws for an unknown modality", () => {
    expect(() =>
      computeCardioMuscleVolume({ modality: "teleportation" as CardioModality, durationMin: 10, intensityFactor: 1, timestampMs: 0 })
    ).toThrow();
  });
});
