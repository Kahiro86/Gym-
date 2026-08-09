import { describe, it, expect } from "vitest";
import { computeSessionXp, streakMultiplier } from "../src/domain/xp.js";
import { requireExercise } from "../src/domain/catalog.js";
import { emptyExerciseHistory } from "../src/domain/types.js";
import type { ExerciseHistory, HistoryContext, LoggedSet, SessionInput } from "../src/domain/types.js";

const BW = 80;
const pushup = requireExercise("pushup");
const bench = requireExercise("barbell-bench-press");

function historyFor(exerciseIds: string[], overrides: Partial<HistoryContext> = {}): HistoryContext {
  const exerciseHistory: Record<string, ExerciseHistory> = {};
  for (const id of exerciseIds) exerciseHistory[id] = emptyExerciseHistory();
  return {
    exerciseHistory,
    isFirstSessionOfDay: false,
    streakWeeks: 0,
    ...overrides,
  };
}

function noPrHistoryFor(exerciseIds: string[], overrides: Partial<HistoryContext> = {}): HistoryContext {
  const noPr: ExerciseHistory = { maxWeightKg: 1e9, maxVolumeSingleSet: 1e9, repsAtLoad: [{ loadKg: 1e9, reps: 1e9 }] };
  const exerciseHistory: Record<string, ExerciseHistory> = {};
  for (const id of exerciseIds) exerciseHistory[id] = noPr;
  return {
    exerciseHistory,
    bodyweightHistory: { maxBodyweightKg: 1e9, minBodyweightKg: 0 },
    isFirstSessionOfDay: false,
    streakWeeks: 0,
    ...overrides,
  };
}

function pushupSet(reps: number, timestamp = 0): LoggedSet {
  return { exerciseId: pushup.id, reps, bodyweightKg: BW, timestamp };
}

describe("computeSessionXp — fragmentation fix (v2 §4.2, critical regression)", () => {
  it("1x50 and 5x10 of the same exercise produce identical session XP", () => {
    const history = historyFor([pushup.id]);
    const oneByFifty = computeSessionXp({ sets: [pushupSet(50)] }, history);
    const fiveByTen = computeSessionXp({ sets: Array.from({ length: 5 }, (_, i) => pushupSet(10, i)) }, history);
    expect(fiveByTen.total).toBeCloseTo(oneByFifty.total, 6);
  });

  it("10x5 of the same exercise also matches", () => {
    const history = historyFor([pushup.id]);
    const oneByFifty = computeSessionXp({ sets: [pushupSet(50)] }, history);
    const tenByFive = computeSessionXp({ sets: Array.from({ length: 10 }, (_, i) => pushupSet(5, i)) }, history);
    expect(tenByFive.total).toBeCloseTo(oneByFifty.total, 6);
  });

  it("no set-splitting arrangement increases session XP, uneven splits included", () => {
    const history = historyFor([pushup.id]);
    const oneByFifty = computeSessionXp({ sets: [pushupSet(50)] }, history);
    const uneven = computeSessionXp({ sets: [pushupSet(30, 0), pushupSet(15, 1), pushupSet(5, 2)] }, history);
    expect(uneven.total).toBeCloseTo(oneByFifty.total, 6);
  });
});

describe("computeSessionXp — per-set marginal breakdown", () => {
  it("sums exactly to the session total (v2 §6: rounding only at display)", () => {
    const history: HistoryContext = {
      exerciseHistory: { [pushup.id]: emptyExerciseHistory() },
      bodyweightHistory: { maxBodyweightKg: BW, minBodyweightKg: BW },
      isFirstSessionOfDay: false,
      streakWeeks: 0,
    };
    const result = computeSessionXp({ sets: Array.from({ length: 5 }, (_, i) => pushupSet(10, i)) }, history);
    const sumOfSetTotals = result.setBreakdowns.reduce((sum, b) => sum + b.total, 0);
    expect(sumOfSetTotals).toBeCloseTo(result.total, 9);
  });

  it("a rep-spammed easy exercise shows sharply diminishing marginal XP per set", () => {
    const history = historyFor([pushup.id]);
    const result = computeSessionXp({ sets: Array.from({ length: 10 }, (_, i) => pushupSet(15, i)) }, history);
    const first = result.setBreakdowns[0]!.total;
    const last = result.setBreakdowns[9]!.total;
    expect(last).toBeLessThan(first);
  });
});

describe("computeSessionXp — compound-lift bonus is intentional (v2 §4.4)", () => {
  it("spreading identical effort across several muscles yields more XP than concentrating it on one", () => {
    const legExtension = requireExercise("leg-extension"); // referenceVolume 300, single muscle
    const history = noPrHistoryFor([bench.id, legExtension.id]);

    // both land at effort = 1.0 (volume === referenceVolume)
    const benchResult = computeSessionXp({ sets: [{ exerciseId: bench.id, weightKg: 40, reps: 8, bodyweightKg: BW, timestamp: 0 }] }, history);
    const legResult = computeSessionXp({ sets: [{ exerciseId: legExtension.id, weightKg: 30, reps: 10, bodyweightKg: BW, timestamp: 0 }] }, history);

    expect(benchResult.total).toBeGreaterThan(legResult.total);
  });
});

describe("computeSessionXp — monotonicity and safety", () => {
  it("is monotonic in reps", () => {
    const history = historyFor([pushup.id]);
    let previous = 0;
    for (const reps of [1, 5, 10, 20, 40]) {
      const result = computeSessionXp({ sets: [pushupSet(reps)] }, history);
      expect(result.total).toBeGreaterThanOrEqual(previous);
      previous = result.total;
    }
  });

  it("is monotonic in load", () => {
    const history = historyFor([bench.id]);
    let previous = 0;
    for (const weightKg of [20, 40, 60, 80]) {
      const result = computeSessionXp({ sets: [{ exerciseId: bench.id, weightKg, reps: 8, bodyweightKg: BW, timestamp: 0 }] }, history);
      expect(result.total).toBeGreaterThanOrEqual(previous);
      previous = result.total;
    }
  });

  it("never produces negative or NaN XP, even for a degenerate zero-volume set", () => {
    const history = historyFor([pushup.id]);
    const result = computeSessionXp({ sets: [pushupSet(0)] }, history);
    expect(Number.isNaN(result.total)).toBe(false);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it("never produces negative or NaN totals across a long session", () => {
    const history = historyFor([pushup.id]);
    const result = computeSessionXp({ sets: Array.from({ length: 20 }, (_, i) => pushupSet(15, i)) }, history);
    expect(Number.isNaN(result.total)).toBe(false);
    expect(result.total).toBeGreaterThanOrEqual(0);
    for (const breakdown of result.setBreakdowns) {
      expect(breakdown.total).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(breakdown.total)).toBe(false);
    }
  });
});

describe("computeSessionXp — PRs, discovery, and the PR cap (v2 §4.6)", () => {
  it("PR bonus never exceeds the +20 cap on any set, even when weight/rep/volume all fire together", () => {
    // zeroed (not undefined) exercise history -> real PRs fire; bodyweight
    // history pre-set to the same value so a bodyweight PR doesn't add noise.
    const history = historyFor([bench.id], { bodyweightHistory: { maxBodyweightKg: BW, minBodyweightKg: BW } });
    const result = computeSessionXp({ sets: [{ exerciseId: bench.id, weightKg: 60, reps: 8, bodyweightKg: BW, timestamp: 0 }] }, history);

    expect(result.prs.length).toBe(3); // all three still reported, for display/achievements
    const prRelated = result.setBreakdowns[0]!.components.filter((c) => c.reason.includes("PR"));
    const prTotal = prRelated.reduce((sum, c) => sum + c.amount, 0);
    expect(prTotal).toBeLessThanOrEqual(20);
    expect(result.setBreakdowns[0]!.components.some((c) => c.label === "PR cap")).toBe(true);
  });

  it("no PR fires on an exercise's first-ever log — the discovery bonus (+20) replaces them", () => {
    const history: HistoryContext = {
      exerciseHistory: {},
      bodyweightHistory: { maxBodyweightKg: BW, minBodyweightKg: BW },
      isFirstSessionOfDay: false,
      streakWeeks: 0,
    };
    const result = computeSessionXp({ sets: [{ exerciseId: bench.id, weightKg: 60, reps: 8, bodyweightKg: BW, timestamp: 0 }] }, history);

    expect(result.prs).toEqual([]);
    const discovery = result.setBreakdowns[0]!.components.find((c) => c.label === "new exercise");
    expect(discovery?.amount).toBe(20);
  });

  it("only the true first set of a never-before-seen exercise gets the discovery bonus", () => {
    const history: HistoryContext = { exerciseHistory: {}, isFirstSessionOfDay: false, streakWeeks: 0 };
    const result = computeSessionXp(
      { sets: [{ exerciseId: bench.id, weightKg: 60, reps: 8, bodyweightKg: BW, timestamp: 0 }, { exerciseId: bench.id, weightKg: 60, reps: 8, bodyweightKg: BW, timestamp: 1 }] },
      history
    );
    expect(result.setBreakdowns[0]!.components.some((c) => c.label === "new exercise")).toBe(true);
    expect(result.setBreakdowns[1]!.components.some((c) => c.label === "new exercise")).toBe(false);
  });
});

describe("computeSessionXp — session bonuses", () => {
  it("adds the session-first bonus only to the first set when isFirstSessionOfDay is true", () => {
    const history = historyFor([pushup.id], { isFirstSessionOfDay: true });
    const result = computeSessionXp({ sets: [pushupSet(10, 0), pushupSet(10, 1)] }, history);
    expect(result.setBreakdowns[0]!.components.some((c) => c.label === "session first")).toBe(true);
    expect(result.setBreakdowns[1]!.components.some((c) => c.label === "session first")).toBe(false);
  });

  it("applies the streak multiplier to the session total, capped at x1.20", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(4)).toBeCloseTo(1.2);
    expect(streakMultiplier(100)).toBeCloseTo(1.2); // capped

    const withStreak = computeSessionXp({ sets: [pushupSet(15)] }, historyFor([pushup.id], { streakWeeks: 4 }));
    const without = computeSessionXp({ sets: [pushupSet(15)] }, historyFor([pushup.id], { streakWeeks: 0 }));
    expect(withStreak.total).toBeGreaterThan(without.total);
    expect(withStreak.total).toBeCloseTo(without.total * 1.2, 6);
  });

  it("has no weekly-target bonus (removed in v2 — it referenced an undefined weekly target)", () => {
    const result = computeSessionXp({ sets: [pushupSet(15)] }, historyFor([pushup.id]));
    expect(result.sessionBonusComponents.some((c) => c.label.includes("weekly"))).toBe(false);
  });
});

describe("SessionInput shape (v2 API break)", () => {
  it("computeSessionXp takes (session, history) as two separate arguments", () => {
    const session: SessionInput = { sets: [pushupSet(10)] };
    const history = historyFor([pushup.id]);
    expect(() => computeSessionXp(session, history)).not.toThrow();
  });
});
