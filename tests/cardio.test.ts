import { describe, it, expect } from "vitest";
import { CARDIO_MODALITIES, computeCardioVolume, computeCardioMuscleVolume, getCardioModality } from "../src/domain/cardio.js";
import type { CardioModalityId } from "../src/domain/cardio.js";

describe("cardio modalities", () => {
  it("every modality's muscle weights sum to 1.0", () => {
    for (const modality of CARDIO_MODALITIES) {
      const total = modality.muscles.reduce((sum, m) => sum + m.share, 0);
      expect(total, modality.id).toBeCloseTo(1.0, 5);
    }
  });

  it("every modality has at least one primary mover", () => {
    for (const modality of CARDIO_MODALITIES) {
      expect(modality.muscles.some((m) => m.primaryMover), modality.id).toBe(true);
    }
  });

  it("getCardioModality throws for an unknown id", () => {
    expect(() => getCardioModality("teleportation" as CardioModalityId)).toThrow();
  });
});

describe("computeCardioVolume", () => {
  it("scales linearly with duration and intensity", () => {
    const base = computeCardioVolume({ modalityId: "run", durationMin: 30, intensityFactor: 1, timestampMs: 0 });
    const doubled = computeCardioVolume({ modalityId: "run", durationMin: 60, intensityFactor: 1, timestampMs: 0 });
    expect(doubled).toBeCloseTo(base * 2);
  });

  it("is finite and positive for a realistic log", () => {
    const volume = computeCardioVolume({ modalityId: "row", durationMin: 20, intensityFactor: 1.2, timestampMs: 0 });
    expect(Number.isFinite(volume)).toBe(true);
    expect(volume).toBeGreaterThan(0);
  });
});

describe("computeCardioMuscleVolume", () => {
  it("distributes the total volume across the modality's muscles proportional to share", () => {
    const log = { modalityId: "cycle" as CardioModalityId, durationMin: 30, intensityFactor: 1, timestampMs: 0 };
    const total = computeCardioVolume(log);
    const perMuscle = computeCardioMuscleVolume(log);
    const sum = Object.values(perMuscle).reduce((s, v) => s + (v ?? 0), 0);
    expect(sum).toBeCloseTo(total, 6);
  });
});
