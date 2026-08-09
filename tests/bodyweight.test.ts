import { describe, it, expect } from "vitest";
import { detectBodyweightPrs, recordBodyweightIntoHistory, BODYWEIGHT_PR_SUBJECT } from "../src/domain/bodyweight.js";
import { emptyBodyweightHistory } from "../src/domain/types.js";
import { computeSessionXp } from "../src/domain/xp.js";
import type { HistoryContext, SessionInput } from "../src/domain/types.js";

describe("detectBodyweightPrs", () => {
  it("the first-ever entry is a max PR (not also a min PR)", () => {
    const prs = detectBodyweightPrs(80, undefined);
    expect(prs).toEqual([
      { type: "bodyweightMax", exerciseId: BODYWEIGHT_PR_SUBJECT, value: 80, previousBest: 0 },
    ]);
  });

  it("fires a max PR on a new high", () => {
    const history = recordBodyweightIntoHistory(80, emptyBodyweightHistory());
    const prs = detectBodyweightPrs(82, history);
    expect(prs).toEqual([
      { type: "bodyweightMax", exerciseId: BODYWEIGHT_PR_SUBJECT, value: 82, previousBest: 80 },
    ]);
  });

  it("fires a min PR on a new low", () => {
    const history = recordBodyweightIntoHistory(80, emptyBodyweightHistory());
    const prs = detectBodyweightPrs(78, history);
    expect(prs).toEqual([
      { type: "bodyweightMin", exerciseId: BODYWEIGHT_PR_SUBJECT, value: 78, previousBest: 80 },
    ]);
  });

  it("fires nothing between the established max and min", () => {
    let history = emptyBodyweightHistory();
    history = recordBodyweightIntoHistory(85, history);
    history = recordBodyweightIntoHistory(75, history);
    expect(detectBodyweightPrs(80, history)).toEqual([]);
  });

  it("fires nothing for an exact repeat", () => {
    const history = recordBodyweightIntoHistory(80, emptyBodyweightHistory());
    expect(detectBodyweightPrs(80, history)).toEqual([]);
  });
});

describe("recordBodyweightIntoHistory", () => {
  it("tracks running max and min independently", () => {
    let history = emptyBodyweightHistory();
    history = recordBodyweightIntoHistory(80, history);
    history = recordBodyweightIntoHistory(78, history);
    history = recordBodyweightIntoHistory(83, history);
    expect(history.maxBodyweightKg).toBe(83);
    expect(history.minBodyweightKg).toBe(78);
  });
});

describe("bodyweight PRs inside a session", () => {
  it("add a session bonus and update history, without depending on any exercise", () => {
    const history: HistoryContext = {
      exerciseHistory: { pushup: { maxWeightKg: 0, maxVolumeSingleSet: 0, repsAtLoad: [] } },
      bodyweightHistory: recordBodyweightIntoHistory(80, emptyBodyweightHistory()),
      isFirstSessionOfDay: false,
      streakWeeks: 0,
    };
    const session: SessionInput = {
      sets: [{ exerciseId: "pushup", reps: 10, bodyweightKg: 79, timestamp: 0 }],
    };

    const result = computeSessionXp(session, history);
    expect(result.prs.some((p) => p.type === "bodyweightMin")).toBe(true);
    expect(result.sessionBonusComponents.some((c) => c.label === "bodyweight low")).toBe(true);
    expect(result.updatedBodyweightHistory).toEqual({ maxBodyweightKg: 80, minBodyweightKg: 79 });
  });

  it("does not fire a bodyweight PR when bodyweight is unchanged", () => {
    const history: HistoryContext = {
      exerciseHistory: { pushup: { maxWeightKg: 0, maxVolumeSingleSet: 0, repsAtLoad: [] } },
      bodyweightHistory: recordBodyweightIntoHistory(80, emptyBodyweightHistory()),
      isFirstSessionOfDay: false,
      streakWeeks: 0,
    };
    const session: SessionInput = {
      sets: [{ exerciseId: "pushup", reps: 10, bodyweightKg: 80, timestamp: 0 }],
    };

    const result = computeSessionXp(session, history);
    expect(result.prs.some((p) => p.type === "bodyweightMax" || p.type === "bodyweightMin")).toBe(false);
  });

  it("defaults bodyweightHistory to empty when the caller omits it", () => {
    const history: HistoryContext = {
      exerciseHistory: { pushup: { maxWeightKg: 0, maxVolumeSingleSet: 0, repsAtLoad: [] } },
      isFirstSessionOfDay: false,
      streakWeeks: 0,
    };
    const session: SessionInput = {
      sets: [{ exerciseId: "pushup", reps: 10, bodyweightKg: 80, timestamp: 0 }],
    };

    const result = computeSessionXp(session, history);
    expect(result.prs.some((p) => p.type === "bodyweightMax")).toBe(true);
  });
});
