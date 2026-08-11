import { describe, it, expect } from "vitest";
import { formatSetSummary } from "../../../src/app/session/formatSet.js";
import type { SetRecord } from "../../../src/storage/types.js";

function baseSet(overrides: Partial<SetRecord>): SetRecord {
  return {
    id: "set1",
    sessionExerciseId: "se1",
    exerciseId: "barbell-bench-press",
    orderIndex: 1000,
    weightKg: null,
    reps: null,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    targetReps: null,
    note: null,
    bodyweightKgAtTime: 80,
    loggedAt: 1000,
    restBeforeSec: null,
    updatedAt: 1000,
    deletedAt: null,
    deviceId: "device1",
    syncedAt: null,
    serverUpdatedAt: null,
    ...overrides,
  };
}

describe("formatSetSummary", () => {
  it("formats weight + reps", () => {
    expect(formatSetSummary(baseSet({ weightKg: 60, reps: 5 }))).toBe("60 kg × 5");
  });

  it("formats reps alone (bodyweight)", () => {
    expect(formatSetSummary(baseSet({ reps: 12 }))).toBe("12 reps");
  });

  it("formats duration", () => {
    expect(formatSetSummary(baseSet({ durationSec: 45 }))).toBe("45s");
  });

  it("formats distance", () => {
    expect(formatSetSummary(baseSet({ distanceM: 500 }))).toBe("500 m");
  });

  it("falls back to an em dash when nothing is set", () => {
    expect(formatSetSummary(baseSet({}))).toBe("—");
  });
});
