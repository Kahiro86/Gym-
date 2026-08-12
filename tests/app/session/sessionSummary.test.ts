import { describe, it, expect } from "vitest";
import { totalMuscleXp } from "../../../src/app/session/sessionSummary.js";
import { MUSCLE_IDS } from "../../../src/domain/muscles.js";
import type { MuscleId } from "../../../src/domain/muscles.js";

function emptyMuscleXp(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) record[muscle] = 0;
  return record;
}

describe("totalMuscleXp", () => {
  it("sums xp across every muscle", () => {
    const muscleXp = emptyMuscleXp();
    muscleXp.chestSternal = 12.5;
    muscleXp.tricepsLong = 4;
    muscleXp.deltAnterior = 2.5;

    expect(totalMuscleXp(muscleXp)).toBeCloseTo(19, 5);
  });

  it("is 0 for an all-zero record", () => {
    expect(totalMuscleXp(emptyMuscleXp())).toBe(0);
  });
});
