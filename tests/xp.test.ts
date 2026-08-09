import { describe, it, expect } from "vitest";
import { computeSetXp, computeSessionXp, diminishingMultiplierFor, XP_CONSTANT } from "../src/domain/xp.js";
import { requireExercise } from "../src/domain/catalog.js";
import { computeSetVolume } from "../src/domain/load.js";
import { emptyExerciseHistory } from "../src/domain/types.js";
import type { HistoryContext, LoggedSet, SessionInput } from "../src/domain/types.js";

const BW = 80;
const pushup = requireExercise("pushup");

function baseContext(overrides: Partial<Parameters<typeof computeSetXp>[2]> = {}) {
  return {
    bodyweightKg: BW,
    prs: [],
    isFirstSetOfDay: false,
    diminishingMultiplier: 1,
    accumulatedEffectiveSets: 0,
    ...overrides,
  };
}

describe("computeSetXp — worked examples from spec §4.5", () => {
  it("pushups x5 -> +4 XP", () => {
    const set: LoggedSet = { exerciseId: pushup.id, reps: 5, timestamp: 0 };
    expect(computeSetVolume(pushup, set, BW)).toBeCloseTo(256);
    const breakdown = computeSetXp(pushup, set, baseContext());
    expect(breakdown.base).toBe(4);
    expect(breakdown.total).toBe(4);
  });

  it("pushups x50 -> +11 XP", () => {
    const set: LoggedSet = { exerciseId: pushup.id, reps: 50, timestamp: 0 };
    expect(computeSetVolume(pushup, set, BW)).toBeCloseTo(2560);
    const breakdown = computeSetXp(pushup, set, baseContext());
    expect(breakdown.base).toBe(11);
    expect(breakdown.total).toBe(11);
  });

  it("pushups x20, first set of the day with a rep PR -> +22 XP", () => {
    const set: LoggedSet = { exerciseId: pushup.id, reps: 20, timestamp: 0 };
    expect(computeSetVolume(pushup, set, BW)).toBeCloseTo(1024);
    const breakdown = computeSetXp(
      pushup,
      set,
      baseContext({
        isFirstSetOfDay: true,
        prs: [{ type: "rep", exerciseId: pushup.id, value: 20, previousBest: 15 }],
      })
    );
    expect(breakdown.base).toBe(7);
    expect(breakdown.total).toBe(22);
  });

  it("ten times the reps yields under three times the XP", () => {
    const five = computeSetXp(pushup, { exerciseId: pushup.id, reps: 5, timestamp: 0 }, baseContext());
    const fifty = computeSetXp(pushup, { exerciseId: pushup.id, reps: 50, timestamp: 0 }, baseContext());
    expect(fifty.total).toBeLessThan(five.total * 3);
  });
});

describe("computeSetXp — monotonicity", () => {
  it("is monotonic in reps", () => {
    let previous = 0;
    for (const reps of [1, 5, 10, 20, 40, 80]) {
      const breakdown = computeSetXp(pushup, { exerciseId: pushup.id, reps, timestamp: 0 }, baseContext());
      expect(breakdown.total).toBeGreaterThanOrEqual(previous);
      previous = breakdown.total;
    }
  });

  it("is monotonic in load", () => {
    const bench = requireExercise("barbell-bench-press");
    let previous = 0;
    for (const weightKg of [20, 40, 60, 80, 100]) {
      const breakdown = computeSetXp(
        bench,
        { exerciseId: bench.id, weightKg, reps: 8, timestamp: 0 },
        baseContext()
      );
      expect(breakdown.total).toBeGreaterThanOrEqual(previous);
      previous = breakdown.total;
    }
  });

  it("never produces negative or NaN XP, even for a degenerate zero-volume set", () => {
    const breakdown = computeSetXp(pushup, { exerciseId: pushup.id, reps: 0, timestamp: 0 }, baseContext());
    expect(Number.isNaN(breakdown.total)).toBe(false);
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
  });
});

describe("diminishingMultiplierFor", () => {
  it("applies the correct multiplier at each boundary", () => {
    expect(diminishingMultiplierFor(0)).toBe(1.0);
    expect(diminishingMultiplierFor(2.99)).toBe(1.0);
    expect(diminishingMultiplierFor(3)).toBe(0.8);
    expect(diminishingMultiplierFor(4.99)).toBe(0.8);
    expect(diminishingMultiplierFor(5)).toBe(0.55);
    expect(diminishingMultiplierFor(7.99)).toBe(0.55);
    expect(diminishingMultiplierFor(8)).toBe(0.3);
    expect(diminishingMultiplierFor(50)).toBe(0.3);
  });

  it("floors at 0.30 rather than zero — training is never worthless", () => {
    expect(diminishingMultiplierFor(1_000_000)).toBe(0.3);
  });
});

function noPrHistory(): HistoryContext {
  const history = {
    ...emptyExerciseHistory(),
    maxWeightKg: 100_000,
    maxVolumeSingleSet: 100_000_000,
    repsAtLoad: [{ loadKg: 100_000, reps: 100_000 }],
  };
  return {
    exerciseHistory: { [pushup.id]: history, "back-squat": history },
    isFirstSessionOfDay: false,
    completesWeeklyTarget: false,
    streakWeeks: 0,
  };
}

describe("computeSessionXp — diminishing returns within a session", () => {
  it("sharply diminishes XP when rep-spamming a single easy exercise", () => {
    // Single-muscle isolation exercise (quads only) so the per-muscle
    // diminishing curve isn't diluted by other muscles staying fresh.
    const legExtension = requireExercise("leg-extension");
    const sets: LoggedSet[] = Array.from({ length: 10 }, (_, i) => ({
      exerciseId: legExtension.id,
      weightKg: 30,
      reps: 12,
      timestamp: i,
    }));

    const history = noPrHistory();
    history.exerciseHistory[legExtension.id] = history.exerciseHistory[pushup.id]!;
    const session: SessionInput = { sets, bodyweightKg: BW, history };
    const result = computeSessionXp(session);

    const first = result.setBreakdowns[0]!.total;
    const last = result.setBreakdowns[9]!.total;
    expect(last).toBeLessThan(first);
    expect(last).toBeLessThanOrEqual(first * 0.5);
  });

  it("never produces negative or NaN totals across a long session", () => {
    const sets: LoggedSet[] = Array.from({ length: 20 }, (_, i) => ({
      exerciseId: pushup.id,
      reps: 15,
      timestamp: i,
    }));
    const session: SessionInput = { sets, bodyweightKg: BW, history: noPrHistory() };
    const result = computeSessionXp(session);
    expect(Number.isNaN(result.total)).toBe(false);
    expect(result.total).toBeGreaterThanOrEqual(0);
    for (const breakdown of result.setBreakdowns) {
      expect(breakdown.total).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(breakdown.total)).toBe(false);
    }
  });
});

describe("computeSessionXp — bonuses", () => {
  it("adds the weekly target bonus once per session", () => {
    const session: SessionInput = {
      sets: [{ exerciseId: pushup.id, reps: 15, timestamp: 0 }],
      bodyweightKg: BW,
      history: { ...noPrHistory(), completesWeeklyTarget: true },
    };
    const withBonus = computeSessionXp(session);
    const without = computeSessionXp({ ...session, history: { ...session.history, completesWeeklyTarget: false } });
    expect(withBonus.total - without.total).toBe(50);
  });

  it("applies the streak multiplier to the session total, capped at x1.20", () => {
    const session: SessionInput = {
      sets: [{ exerciseId: pushup.id, reps: 15, timestamp: 0 }],
      bodyweightKg: BW,
      history: { ...noPrHistory(), streakWeeks: 4 },
    };
    const withStreak = computeSessionXp(session);
    const without = computeSessionXp({ ...session, history: { ...session.history, streakWeeks: 0 } });
    expect(withStreak.total).toBeGreaterThan(without.total);

    const uncappedSession: SessionInput = {
      ...session,
      history: { ...session.history, streakWeeks: 100 },
    };
    const uncapped = computeSessionXp(uncappedSession);
    expect(uncapped.total).toBe(withStreak.total); // capped at 4 weeks (x1.20) either way
  });
});
