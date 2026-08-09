import { describe, it, expect } from "vitest";
import { detectPrs, recordSetIntoHistory } from "../src/domain/prs.js";
import { requireExercise } from "../src/domain/catalog.js";
import { emptyExerciseHistory } from "../src/domain/types.js";
import type { LoggedSet } from "../src/domain/types.js";

const BW = 80;
const bench = requireExercise("barbell-bench-press");

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return { exerciseId: bench.id, bodyweightKg: BW, timestamp: 0, ...overrides };
}

describe("detectPrs", () => {
  it("no PRs fire on an exercise's first-ever log — undefined history is the signal (v2 §4.6)", () => {
    const prs = detectPrs(bench, set({ weightKg: 60, reps: 8 }), undefined);
    expect(prs).toEqual([]);
  });

  it("PRs fire normally once real (even zeroed) history exists — only `undefined` suppresses them", () => {
    const prs = detectPrs(bench, set({ weightKg: 60, reps: 8 }), emptyExerciseHistory());
    const types = prs.map((p) => p.type).sort();
    expect(types).toEqual(["rep", "volume", "weight"]);
  });

  it("does not PR when matching a previous best exactly", () => {
    let history = emptyExerciseHistory();
    history = recordSetIntoHistory(bench, set({ weightKg: 60, reps: 8 }), history);

    const prs = detectPrs(bench, set({ weightKg: 60, reps: 8 }), history);
    expect(prs).toEqual([]);
  });

  it("weight PR fires on a heavier load even at lower reps", () => {
    let history = emptyExerciseHistory();
    history = recordSetIntoHistory(bench, set({ weightKg: 60, reps: 8 }), history);

    const prs = detectPrs(bench, set({ weightKg: 65, reps: 3 }), history);
    expect(prs.some((p) => p.type === "weight")).toBe(true);
  });

  it("rep PR requires more reps than ever achieved at that load or heavier", () => {
    let history = emptyExerciseHistory();
    history = recordSetIntoHistory(bench, set({ weightKg: 60, reps: 8 }), history);
    history = recordSetIntoHistory(bench, set({ weightKg: 70, reps: 3 }), history);

    // 6 reps at 65kg: fewer reps than the 8 already done at 60kg (a lighter-or-equal
    // load), so 65kg >= 60kg's own bar isn't what matters — reps must beat the
    // best ever seen at load >= 65kg, which is 3 (from the 70kg set).
    const prs = detectPrs(bench, set({ weightKg: 65, reps: 6 }), history);
    expect(prs.some((p) => p.type === "rep")).toBe(true);
  });

  it("volume PR fires whenever single-set volume exceeds the historical max", () => {
    let history = emptyExerciseHistory();
    history = recordSetIntoHistory(bench, set({ weightKg: 60, reps: 8 }), history); // volume 480

    const prs = detectPrs(bench, set({ weightKg: 50, reps: 12 }), history); // volume 600
    const volumePr = prs.find((p) => p.type === "volume");
    expect(volumePr).toEqual({ type: "volume", exerciseId: bench.id, value: 600, previousBest: 480 });
  });

  it("skips rep PRs for time-based exercises (no reps concept)", () => {
    const plank = requireExercise("plank");
    const prs = detectPrs(plank, { exerciseId: plank.id, bodyweightKg: BW, timestamp: 0, durationSec: 60 }, emptyExerciseHistory());
    expect(prs.some((p) => p.type === "rep")).toBe(false);
  });
});
