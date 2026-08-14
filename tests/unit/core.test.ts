import { describe, it, expect } from "vitest";
import {
  computeScore, countCompletions, getScoreColor, SCORE_COLOR_HEX,
  computeStreakRuns, computeCurrentStreak, computeBestStreaks,
  computeTrend, computeHistory, computeHeatmap,
  spanForTrend, spanForHeatmap, spanForStreaks, toEntryMap,
} from "../../src/logic/core.js";
import { resolvePeriodRange } from "../../src/logic/period.js";
import { dateRange } from "../../src/logic/dates.js";
import { makeHabit, entriesFrom, entriesForRange } from "./factories.js";

const EMPTY = toEntryMap([]);

describe("getScoreColor", () => {
  it("uses the spec's thresholds at every boundary", () => {
    expect(getScoreColor(0)).toBe("danger-red");
    expect(getScoreColor(39)).toBe("danger-red");
    expect(getScoreColor(40)).toBe("accent-gold");
    expect(getScoreColor(69)).toBe("accent-gold");
    expect(getScoreColor(70)).toBe("success-green");
    expect(getScoreColor(100)).toBe("success-green");
  });

  it("maps to the spec's hex values", () => {
    expect(SCORE_COLOR_HEX[getScoreColor(85)]).toBe("#7BC862");
    expect(SCORE_COLOR_HEX[getScoreColor(50)]).toBe("#D4A843");
    expect(SCORE_COLOR_HEX[getScoreColor(10)]).toBe("#E05252");
  });
});

describe("computeScore", () => {
  const habit = makeHabit({ createdDate: "2026-08-01" });

  it("is 0 for a habit with no entries, not NaN", () => {
    const score = computeScore(habit, EMPTY, "2026-08-01", "2026-08-07");
    expect(score).toBe(0);
    expect(Number.isNaN(score)).toBe(false);
  });

  it("is 100 when every scheduled day is completed", () => {
    expect(computeScore(habit, entriesForRange("2026-08-01", "2026-08-07"), "2026-08-01", "2026-08-07")).toBe(100);
  });

  it("rounds the completion ratio", () => {
    // 2 of 3 days -> 66.67 -> 67
    const entries = entriesFrom({ "2026-08-01": 1, "2026-08-02": 1, "2026-08-03": 0 });
    expect(computeScore(habit, entries, "2026-08-01", "2026-08-03")).toBe(67);
  });

  it("treats an explicit miss the same as an unlogged day for scoring", () => {
    const missed = entriesFrom({ "2026-08-01": 1, "2026-08-02": 0 });
    const unlogged = entriesFrom({ "2026-08-01": 1 });
    expect(computeScore(habit, missed, "2026-08-01", "2026-08-02"))
      .toBe(computeScore(habit, unlogged, "2026-08-01", "2026-08-02"));
  });

  it("is 0 when the window contains no scheduled days", () => {
    const mondays = makeHabit({ createdDate: "2026-08-01", frequencyType: "specific_days", frequencyDays: [1] });
    // Tue..Sun contains no Monday -> no division by zero.
    expect(computeScore(mondays, EMPTY, "2026-08-11", "2026-08-16")).toBe(0);
  });

  it("ignores completions logged on unscheduled days", () => {
    const mondays = makeHabit({ createdDate: "2026-08-01", frequencyType: "specific_days", frequencyDays: [1] });
    // Mon 10th completed; Tue 11th also logged but is not scheduled.
    const entries = entriesFrom({ "2026-08-10": 1, "2026-08-11": 1 });
    expect(countCompletions(mondays, entries, "2026-08-10", "2026-08-16")).toBe(1);
    expect(computeScore(mondays, entries, "2026-08-10", "2026-08-16")).toBe(100);
  });

  it("clamps to 100 when a times_per_week habit is over-logged", () => {
    const h = makeHabit({ createdDate: "2026-08-01", frequencyType: "times_per_week", frequencyCount: 3 });
    // Expected 3, logged 7 -> 233% before clamping.
    expect(computeScore(h, entriesForRange("2026-08-09", "2026-08-15"), "2026-08-09", "2026-08-15")).toBe(100);
  });

  it("returns 0 for an inverted range", () => {
    expect(computeScore(habit, entriesForRange("2026-08-01", "2026-08-07"), "2026-08-07", "2026-08-01")).toBe(0);
  });
});

describe("resolvePeriodRange", () => {
  it("uses trailing windows of the documented length", () => {
    const h = makeHabit({ createdDate: "2020-01-01" });
    expect(resolvePeriodRange("week", "2026-08-14", h)).toEqual({ start: "2026-08-08", end: "2026-08-14" });
    expect(resolvePeriodRange("month", "2026-08-14", h)).toEqual({ start: "2026-07-16", end: "2026-08-14" });
    expect(resolvePeriodRange("year", "2026-08-14", h).start).toBe("2025-08-15");
  });

  it("never starts before the habit existed", () => {
    const h = makeHabit({ createdDate: "2026-08-12" });
    expect(resolvePeriodRange("month", "2026-08-14", h)).toEqual({ start: "2026-08-12", end: "2026-08-14" });
  });

  it("spans creation to today for 'all'", () => {
    const h = makeHabit({ createdDate: "2026-03-05" });
    expect(resolvePeriodRange("all", "2026-08-14", h)).toEqual({ start: "2026-03-05", end: "2026-08-14" });
  });

  it("does not clamp to the first entry, so abandoned habits still decay", () => {
    // Created Aug 1, logged only Aug 1, today is Aug 14: a first-entry
    // clamp would report 100%, which would be wrong.
    const h = makeHabit({ createdDate: "2026-08-01" });
    const score = computeScore(h, entriesFrom({ "2026-08-01": 1 }), ...rangeOf(resolvePeriodRange("month", "2026-08-14", h)));
    expect(score).toBeLessThan(20);
  });
});

function rangeOf(span: { start: string; end: string }): [string, string] {
  return [span.start, span.end];
}

describe("computeStreakRuns", () => {
  const habit = makeHabit({ createdDate: "2026-08-01" });

  it("returns nothing for an empty habit", () => {
    expect(computeStreakRuns(habit, EMPTY, "2026-08-01", "2026-08-10")).toEqual([]);
  });

  it("finds a single run with correct bounds and length", () => {
    const entries = entriesForRange("2026-08-02", "2026-08-05");
    expect(computeStreakRuns(habit, entries, "2026-08-01", "2026-08-10"))
      .toEqual([{ startDate: "2026-08-02", endDate: "2026-08-05", length: 4 }]);
  });

  it("splits runs on an explicit miss", () => {
    const entries = entriesFrom({
      "2026-08-01": 1, "2026-08-02": 1, "2026-08-03": 0, "2026-08-04": 1, "2026-08-05": 1, "2026-08-06": 1,
    });
    const runs = computeStreakRuns(habit, entries, "2026-08-01", "2026-08-06");
    expect(runs.map((r) => r.length)).toEqual([2, 3]);
  });

  it("splits runs on an unlogged gap", () => {
    const entries = entriesFrom({ "2026-08-01": 1, "2026-08-02": 1, "2026-08-04": 1 });
    expect(computeStreakRuns(habit, entries, "2026-08-01", "2026-08-04").map((r) => r.length)).toEqual([2, 1]);
  });

  it("does not break a streak on a non-scheduled day", () => {
    // Mon/Wed/Fri. Completing Mon 10, Wed 12, Fri 14 is one run of 3 even
    // though Tue and Thu sit between them untouched.
    const mwf = makeHabit({ createdDate: "2026-08-01", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    const entries = entriesFrom({ "2026-08-10": 1, "2026-08-12": 1, "2026-08-14": 1 });
    expect(computeStreakRuns(mwf, entries, "2026-08-10", "2026-08-14"))
      .toEqual([{ startDate: "2026-08-10", endDate: "2026-08-14", length: 3 }]);
  });

  it("carries a run across a month boundary", () => {
    const h = makeHabit({ createdDate: "2026-08-01" });
    const entries = entriesForRange("2026-08-28", "2026-09-03");
    expect(computeStreakRuns(h, entries, "2026-08-01", "2026-09-10"))
      .toEqual([{ startDate: "2026-08-28", endDate: "2026-09-03", length: 7 }]);
  });

  it("carries a run across a year boundary", () => {
    const h = makeHabit({ createdDate: "2025-12-01" });
    const entries = entriesForRange("2025-12-29", "2026-01-04");
    expect(computeStreakRuns(h, entries, "2025-12-01", "2026-01-31"))
      .toEqual([{ startDate: "2025-12-29", endDate: "2026-01-04", length: 7 }]);
  });

  it("carries a run across a leap day", () => {
    const h = makeHabit({ createdDate: "2028-02-01" });
    const entries = entriesForRange("2028-02-27", "2028-03-02");
    const runs = computeStreakRuns(h, entries, "2028-02-01", "2028-03-31");
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(5); // 27, 28, 29, 1, 2
  });
});

describe("computeCurrentStreak", () => {
  const habit = makeHabit({ createdDate: "2026-08-01" });

  it("is 0 for an empty habit", () => {
    expect(computeCurrentStreak(habit, EMPTY, "2026-08-14")).toBe(0);
  });

  it("counts a run that includes today", () => {
    expect(computeCurrentStreak(habit, entriesForRange("2026-08-10", "2026-08-14"), "2026-08-14")).toBe(5);
  });

  it("keeps the streak alive when today is scheduled but not yet logged", () => {
    // The day is not over; the streak through yesterday still stands.
    expect(computeCurrentStreak(habit, entriesForRange("2026-08-10", "2026-08-13"), "2026-08-14")).toBe(4);
  });

  it("breaks the streak when today is explicitly missed", () => {
    const entries = new Map(entriesForRange("2026-08-10", "2026-08-13"));
    entries.set("2026-08-14", { ...entries.get("2026-08-13")!, date: "2026-08-14", value: 0 });
    expect(computeCurrentStreak(habit, entries, "2026-08-14")).toBe(4);
  });

  it("is 0 when the last run ended before yesterday", () => {
    expect(computeCurrentStreak(habit, entriesForRange("2026-08-01", "2026-08-05"), "2026-08-14")).toBe(0);
  });

  it("is 0 when today precedes the habit's creation", () => {
    const future = makeHabit({ createdDate: "2026-09-01" });
    expect(computeCurrentStreak(future, EMPTY, "2026-08-14")).toBe(0);
  });

  it("counts a single completion on the habit's first day", () => {
    const h = makeHabit({ createdDate: "2026-08-14" });
    expect(computeCurrentStreak(h, entriesFrom({ "2026-08-14": 1 }), "2026-08-14")).toBe(1);
  });

  it("survives a month boundary", () => {
    const h = makeHabit({ createdDate: "2026-08-01" });
    expect(computeCurrentStreak(h, entriesForRange("2026-08-28", "2026-09-03"), "2026-09-03")).toBe(7);
  });

  // The streak is measured against the days the habit was actually due.
  // Anchoring it on "yesterday" breaks every non-daily habit whenever
  // yesterday happened to be an off day.
  it("stays alive on a Mon/Wed/Fri habit when yesterday was not a scheduled day", () => {
    const mwf = makeHabit({ createdDate: "2026-08-01", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    const entries = entriesFrom({
      "2026-08-03": 1, "2026-08-05": 1, "2026-08-07": 1, // Mon, Wed, Fri
      "2026-08-10": 1, "2026-08-12": 1, "2026-08-14": 1, // Mon, Wed, Fri
    });
    // Friday the 14th: the previous scheduled day was Wednesday the 12th,
    // and Thursday was never due.
    expect(computeCurrentStreak(mwf, entries, "2026-08-14")).toBe(6);
  });

  it("keeps a Mon/Wed/Fri streak over a weekend when today is unlogged", () => {
    const mwf = makeHabit({ createdDate: "2026-08-01", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    const entries = entriesFrom({ "2026-08-05": 1, "2026-08-07": 1 }); // Wed, Fri
    // Monday the 10th, not yet logged: Sat and Sun were never due, so the
    // Wed-Fri run is still live.
    expect(computeCurrentStreak(mwf, entries, "2026-08-10")).toBe(2);
  });

  it("still breaks a Mon/Wed/Fri streak when the last DUE day was missed", () => {
    const mwf = makeHabit({ createdDate: "2026-08-01", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    const entries = entriesFrom({ "2026-08-05": 1, "2026-08-07": 0 }); // Wed done, Fri missed
    expect(computeCurrentStreak(mwf, entries, "2026-08-10")).toBe(0);
  });

  it("counts today alone when it is the habit's first scheduled day", () => {
    const mwf = makeHabit({ createdDate: "2026-08-14", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    expect(computeCurrentStreak(mwf, entriesFrom({ "2026-08-14": 1 }), "2026-08-14")).toBe(1);
  });
});

describe("computeBestStreaks", () => {
  const habit = makeHabit({ createdDate: "2026-08-01" });

  it("returns an empty array for a habit with no entries", () => {
    expect(computeBestStreaks(habit, EMPTY, "2026-08-14", 5)).toEqual([]);
  });

  it("sorts longest first and respects the limit", () => {
    const entries = entriesFrom({
      "2026-08-01": 1, "2026-08-02": 1,                       // run of 2
      "2026-08-05": 1, "2026-08-06": 1, "2026-08-07": 1, "2026-08-08": 1, // run of 4
      "2026-08-11": 1, "2026-08-12": 1, "2026-08-13": 1,      // run of 3
    });
    const best = computeBestStreaks(habit, entries, "2026-08-14", 5);
    expect(best.map((r) => r.length)).toEqual([4, 3, 2]);
    expect(best[0]).toEqual({ startDate: "2026-08-05", endDate: "2026-08-08", length: 4 });
    expect(computeBestStreaks(habit, entries, "2026-08-14", 2).map((r) => r.length)).toEqual([4, 3]);
  });

  it("breaks ties by earlier start date so ordering is stable", () => {
    const entries = entriesFrom({
      "2026-08-10": 1, "2026-08-11": 1,
      "2026-08-01": 1, "2026-08-02": 1,
    });
    const best = computeBestStreaks(habit, entries, "2026-08-14", 5);
    expect(best.map((r) => r.startDate)).toEqual(["2026-08-01", "2026-08-10"]);
  });

  it("returns nothing when limit is 0", () => {
    expect(computeBestStreaks(habit, entriesForRange("2026-08-01", "2026-08-05"), "2026-08-14", 0)).toEqual([]);
  });
});

describe("computeTrend", () => {
  it("returns fewer than 2 points for a same-day habit, so the UI can say 'not enough data'", () => {
    const h = makeHabit({ createdDate: "2026-08-14" });
    expect(computeTrend(h, EMPTY, "2026-08-14", "week").length).toBeLessThan(2);
  });

  it("emits one point per day for week and month periods", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    expect(computeTrend(h, EMPTY, "2026-08-14", "week")).toHaveLength(7);
    expect(computeTrend(h, EMPTY, "2026-08-14", "month")).toHaveLength(30);
  });

  it("emits monthly points for year, ending today", () => {
    const h = makeHabit({ createdDate: "2020-01-01" });
    const points = computeTrend(h, EMPTY, "2026-08-14", "year");
    expect(points.length).toBeLessThanOrEqual(12);
    expect(points[points.length - 1].date).toBe("2026-08-14");
  });

  it("keeps points chronological with scores inside 0-100", () => {
    const h = makeHabit({ createdDate: "2026-06-01" });
    const points = computeTrend(h, entriesForRange("2026-07-01", "2026-08-14"), "2026-08-14", "month");
    const dates = points.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
    expect(points.every((p) => p.score >= 0 && p.score <= 100)).toBe(true);
  });

  it("reaches 100 once the trailing window is fully completed", () => {
    const h = makeHabit({ createdDate: "2026-06-01" });
    const points = computeTrend(h, entriesForRange("2026-07-01", "2026-08-14"), "2026-08-14", "month");
    expect(points[points.length - 1].score).toBe(100);
  });

  it("asks for a span starting before the first point, to fill its rolling window", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const span = spanForTrend(h, "2026-08-14", "week");
    const firstPoint = computeTrend(h, EMPTY, "2026-08-14", "week")[0].date;
    expect(span.start < firstPoint).toBe(true);
  });
});

describe("computeHistory", () => {
  it("returns empty when today precedes creation", () => {
    const h = makeHabit({ createdDate: "2026-09-01" });
    expect(computeHistory(h, EMPTY, "2026-08-14", "week")).toEqual([]);
  });

  it("emits at most 8 weekly buckets, oldest first, ending today", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const buckets = computeHistory(h, EMPTY, "2026-08-14", "week");
    expect(buckets).toHaveLength(8);
    expect(buckets.map((b) => b.start)).toEqual([...buckets.map((b) => b.start)].sort());
    expect(buckets[buckets.length - 1].end).toBe("2026-08-14");
  });

  it("emits at most 6 monthly buckets", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    expect(computeHistory(h, EMPTY, "2026-08-14", "month")).toHaveLength(6);
  });

  it("never emits a bucket that starts before the habit existed", () => {
    const h = makeHabit({ createdDate: "2026-08-05" });
    const buckets = computeHistory(h, EMPTY, "2026-08-14", "week");
    expect(buckets.every((b) => b.start >= "2026-08-05")).toBe(true);
  });

  it("counts completions per bucket and flags the ones that hit target", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const buckets = computeHistory(h, entriesForRange("2026-08-09", "2026-08-14"), "2026-08-14", "week");
    const last = buckets[buckets.length - 1];
    expect(last.count).toBe(6);
    expect(last.met).toBe(true);
    expect(buckets[0].count).toBe(0);
    expect(buckets[0].met).toBe(false);
  });

  it("zero-completion buckets are reported, not omitted", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const buckets = computeHistory(h, EMPTY, "2026-08-14", "week");
    expect(buckets.every((b) => b.count === 0 && b.met === false)).toBe(true);
  });
});

describe("computeHeatmap", () => {
  const habit = makeHabit({ createdDate: "2026-08-01" });

  it("returns one entry per day of the requested month", () => {
    expect(computeHeatmap(habit, EMPTY, "2026-08-14", "2026-08")).toHaveLength(31);
    expect(computeHeatmap(makeHabit({ createdDate: "2026-02-01" }), EMPTY, "2026-02-28", "2026-02")).toHaveLength(28);
    expect(computeHeatmap(makeHabit({ createdDate: "2028-02-01" }), EMPTY, "2028-02-29", "2028-02")).toHaveLength(29);
  });

  it("is level 0 everywhere for a habit with no entries", () => {
    expect(computeHeatmap(habit, EMPTY, "2026-08-14", "2026-08").every((d) => d.level === 0)).toBe(true);
  });

  it("keeps future days at level 0", () => {
    const days = computeHeatmap(habit, entriesForRange("2026-08-01", "2026-08-14"), "2026-08-14", "2026-08");
    expect(days.filter((d) => d.date > "2026-08-14").every((d) => d.level === 0)).toBe(true);
  });

  it("keeps days before the habit existed at level 0", () => {
    const late = makeHabit({ createdDate: "2026-08-20" });
    const days = computeHeatmap(late, entriesForRange("2026-08-20", "2026-08-25"), "2026-08-25", "2026-08");
    expect(days.filter((d) => d.date < "2026-08-20").every((d) => d.level === 0)).toBe(true);
  });

  it("reaches the top level on a fully-completed stretch", () => {
    const days = computeHeatmap(habit, entriesForRange("2026-08-01", "2026-08-14"), "2026-08-14", "2026-08");
    expect(days.find((d) => d.date === "2026-08-14")!.level).toBe(4);
  });

  it("keeps every level inside 0-4", () => {
    const patchy = entriesFrom({
      "2026-08-02": 1, "2026-08-05": 1, "2026-08-06": 1, "2026-08-09": 1,
      "2026-08-10": 0, "2026-08-11": 1, "2026-08-13": 1,
    });
    const days = computeHeatmap(habit, patchy, "2026-08-14", "2026-08");
    expect(days.every((d) => d.level >= 0 && d.level <= 4)).toBe(true);
  });

  it("grades partial consistency below the top level", () => {
    // Two of the seven trailing days completed -> mid-ramp, not full.
    const sparse = entriesFrom({ "2026-08-13": 1, "2026-08-14": 1 });
    const level = computeHeatmap(habit, sparse, "2026-08-14", "2026-08").find((d) => d.date === "2026-08-14")!.level;
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(4);
  });

  it("asks for a span reaching into the previous month to fill early windows", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    expect(spanForHeatmap(h, "2026-08").start).toBe("2026-07-26");
    expect(spanForHeatmap(h, "2026-08").end).toBe("2026-08-31");
  });
});

describe("span helpers cover exactly what the compute functions read", () => {
  it("streak span runs from creation to today", () => {
    const h = makeHabit({ createdDate: "2026-03-05" });
    expect(spanForStreaks(h, "2026-08-14")).toEqual({ start: "2026-03-05", end: "2026-08-14" });
  });

  it("a trend span never starts before the habit existed", () => {
    const h = makeHabit({ createdDate: "2026-08-13" });
    expect(spanForTrend(h, "2026-08-14", "month").start).toBe("2026-08-13");
  });

  it("a heatmap span never starts before the habit existed", () => {
    const h = makeHabit({ createdDate: "2026-08-03" });
    expect(spanForHeatmap(h, "2026-08").start).toBe("2026-08-03");
  });
});

describe("scores stay consistent as ranges grow", () => {
  it("a perfect habit scores 100 over every window length", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const entries = entriesForRange("2026-01-01", "2026-08-14");
    for (const days of [1, 7, 30, 90]) {
      const start = dateRange("2026-01-01", "2026-08-14").slice(-days)[0];
      expect(computeScore(h, entries, start, "2026-08-14")).toBe(100);
    }
  });
});
