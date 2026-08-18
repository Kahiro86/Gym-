// Layer 2b §8 tests 1-14. Quota shapes, at_most direction, and the
// scoring boundaries.
//
// These are pure-function tests on purpose: the whole reason §2.3 asks
// for a named getFrequencyShape rather than a branch buried in a large
// function is so the distinction can be tested directly.
import { describe, expect, it } from "vitest";
import {
  getFrequencyShape, quotaUnit, quotaRequired, describeQuota,
  periodContaining, periodsBetween, computeQuotaState,
} from "../../src/logic/frequency.js";
import {
  computeScore, computeScoreOrNull, computeCurrentStreak, computeBestStreaks,
  computeHistory, computeHeatmap, toEntryMap,
} from "../../src/logic/core.js";
import { makeHabit, makeEntry } from "./factories.js";
import type { Entry, Habit } from "../../src/db/types.js";

/** Friday. Its Mon-Sun week starts 2026-08-10. */
const TODAY = "2026-08-14";

const entriesOn = (dates: string[], value = 1) =>
  toEntryMap(dates.map((d) => makeEntry(d, value)));

const weekly = (count: number, over: Partial<Habit> = {}) => makeHabit({
  frequencyType: "times_per_week", frequencyCount: count, createdDate: "2026-01-01", ...over,
});
const monthly = (count: number) => makeHabit({
  frequencyType: "times_per_month", frequencyCount: count, createdDate: "2026-01-01",
});

describe("getFrequencyShape", () => {
  it("calls daily and specific_days scheduled — they have a per-day answer", () => {
    expect(getFrequencyShape(makeHabit({ frequencyType: "daily" }))).toBe("scheduled");
    expect(getFrequencyShape(makeHabit({ frequencyType: "specific_days", frequencyDays: [1] }))).toBe("scheduled");
  });

  it("calls times_per_week and times_per_month quota — they do not", () => {
    expect(getFrequencyShape(weekly(3))).toBe("quota");
    expect(getFrequencyShape(monthly(10))).toBe("quota");
  });
});

describe("5. quota_week_boundary_monday", () => {
  it("a week runs Monday to Sunday", () => {
    // Sunday the 16th belongs to the week that began Monday the 10th,
    // not to the one starting the 17th. Getting this backwards shifts
    // every quota by a day and is invisible until a Sunday.
    expect(periodContaining(weekly(3), "2026-08-16")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(periodContaining(weekly(3), "2026-08-10")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(periodContaining(weekly(3), "2026-08-17")).toEqual({ start: "2026-08-17", end: "2026-08-23" });
  });

  it("a month period is the calendar month", () => {
    expect(periodContaining(monthly(10), "2026-02-15")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodContaining(monthly(10), "2028-02-15").end).toBe("2028-02-29");
  });

  it("periodsBetween covers every whole period the range touches", () => {
    const ps = periodsBetween(weekly(3), "2026-08-05", "2026-08-14");
    expect(ps.map((p) => p.start)).toEqual(["2026-08-03", "2026-08-10"]);
  });

  it("describeQuota reads the way people say it", () => {
    expect(describeQuota(weekly(3))).toBe("3× per week");
    expect(describeQuota(monthly(12))).toBe("12× per month");
    expect(quotaUnit(monthly(1))).toBe("month");
    expect(quotaRequired(weekly(4))).toBe(4);
  });
});

describe("4. quota_state_shape_correct", () => {
  it("reports required, completed, remaining and the period bounds", () => {
    const h = weekly(3);
    const state = computeQuotaState(h, entriesOn(["2026-08-10", "2026-08-12"]), TODAY, TODAY);
    expect(state).toEqual({
      required: 3, completed: 2, remaining: 1,
      periodStart: "2026-08-10", periodEnd: "2026-08-16",
      met: false, inProgress: true,
    });
  });

  it("remaining never goes negative when the quota is beaten", () => {
    const state = computeQuotaState(weekly(3), entriesOn(["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"]), TODAY, TODAY);
    expect(state.remaining).toBe(0);
    expect(state.met).toBe(true);
  });

  it("counts only elapsed days, never into the future", () => {
    // Entries dated after today cannot count — they have not happened.
    const state = computeQuotaState(weekly(3), entriesOn(["2026-08-16"]), TODAY, TODAY);
    expect(state.completed).toBe(0);
  });

  it("a finished period is not in progress", () => {
    const state = computeQuotaState(weekly(3), entriesOn([]), "2026-08-03", TODAY);
    expect(state.inProgress).toBe(false);
  });
});

describe("1. quota_streak_counts_periods_not_days", () => {
  const met4 = entriesOn([
    "2026-07-13", "2026-07-14", "2026-07-15", // week of 13th
    "2026-07-20", "2026-07-21", "2026-07-22", // week of 20th
    "2026-07-27", "2026-07-28", "2026-07-29", // week of 27th
    "2026-08-03", "2026-08-04", "2026-08-05", // week of 3rd
  ]);

  it("four consecutive weeks of hitting 3 reports streak 4, not 12", () => {
    // 12 would be the day count, which is the bug this test exists for.
    expect(computeCurrentStreak(weekly(3), "2026-01-01", met4, TODAY)).toBe(4);
  });

  it("a week that fell short ends the run", () => {
    const withGap = entriesOn([
      "2026-07-13", "2026-07-14", "2026-07-15",
      "2026-07-20", // only one — the quota was missed
      "2026-07-27", "2026-07-28", "2026-07-29",
      "2026-08-03", "2026-08-04", "2026-08-05",
    ]);
    expect(computeCurrentStreak(weekly(3), "2026-01-01", withGap, TODAY)).toBe(2);
  });

  it("the current week extends the streak once its quota is met", () => {
    const plusThisWeek = toEntryMap([
      ...[...met4.values()],
      makeEntry("2026-08-10", 1), makeEntry("2026-08-11", 1), makeEntry("2026-08-12", 1),
    ] as Entry[]);
    expect(computeCurrentStreak(weekly(3), "2026-01-01", plusThisWeek, TODAY)).toBe(5);
  });

  it("best streaks are counted in periods too", () => {
    const runs = computeBestStreaks(weekly(3), "2026-01-01", met4, TODAY, 5);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(4);
    expect(runs[0].startDate).toBe("2026-07-13");
  });
});

describe("2. quota_current_period_not_broken", () => {
  it("Tuesday with 0 of 3 done does not break the streak", () => {
    // Without this, every quota habit reads streak 0 for most of every
    // week — the exact failure §2.2 warns about.
    const tuesday = "2026-08-11";
    const priorWeeks = entriesOn([
      "2026-07-27", "2026-07-28", "2026-07-29",
      "2026-08-03", "2026-08-04", "2026-08-05",
    ]);
    expect(computeCurrentStreak(weekly(3), "2026-01-01", priorWeeks, tuesday)).toBe(2);
  });

  it("an unfinished week does not end a best-streak run either", () => {
    const priorWeeks = entriesOn([
      "2026-07-27", "2026-07-28", "2026-07-29",
      "2026-08-03", "2026-08-04", "2026-08-05",
    ]);
    const runs = computeBestStreaks(weekly(3), "2026-01-01", priorWeeks, "2026-08-11", 5);
    expect(runs[0].length).toBe(2);
  });
});

describe("3. quota_score_caps_at_100", () => {
  it("five completions against a quota of three scores 100, not 167", () => {
    const five = entriesOn(["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]);
    expect(computeScore(weekly(3), five, "2026-08-10", "2026-08-16", TODAY)).toBe(100);
  });

  it("two of three is 67, not a day-based number", () => {
    const two = entriesOn(["2026-08-10", "2026-08-12"]);
    expect(computeScore(weekly(3), two, "2026-08-10", "2026-08-16", TODAY)).toBe(67);
  });

  it("a met week and an unfinished one weigh by how much has elapsed", () => {
    const mixed = entriesOn(["2026-08-03", "2026-08-04", "2026-08-05"]);
    // Week of the 3rd: 3 of 3, a whole week, so it carries full weight.
    // Week of the 10th: 0 of 3, but only Mon-Fri have happened, so it
    // asks for 3 x 5/7 rather than a full quota from five days.
    //   earned   = 3
    //   possible = 3 + 3 x 5/7 = 5.14
    //   score    = 58
    // A flat mean would say 50, which charges the user for a Saturday
    // and Sunday that have not arrived.
    expect(computeScore(weekly(3), mixed, "2026-08-03", "2026-08-16", TODAY)).toBe(58);
  });

  it("once the week is over, the same data is a flat mean", () => {
    const mixed = entriesOn(["2026-08-03", "2026-08-04", "2026-08-05"]);
    // Asked on the following Monday, both weeks are complete: 100 and 0.
    expect(computeScore(weekly(3), mixed, "2026-08-03", "2026-08-16", "2026-08-17")).toBe(50);
  });

  it("history bars count completions per period against the quota", () => {
    const bars = computeHistory(weekly(3), "2026-08-03", entriesOn([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-10",
    ]), TODAY, "week");
    expect(bars.map((b) => `${b.start}:${b.count}:${b.met}`))
      .toEqual(["2026-08-03:3:true", "2026-08-10:1:false"]);
  });
});

describe("6-9. at_most direction", () => {
  const limit = (target: number) => makeHabit({
    type: "numeric", target, targetDirection: "at_most", unit: "min", createdDate: "2026-01-01",
  });

  it("6. atmost_lower_is_better — [0, 5, 40] against 30 scores 2 of 3", () => {
    const entries = toEntryMap([
      makeEntry("2026-08-12", 0), makeEntry("2026-08-13", 5), makeEntry("2026-08-14", 40),
    ]);
    expect(computeScore(limit(30), entries, "2026-08-12", "2026-08-14", TODAY)).toBe(67);
  });

  it("7. atmost_zero_is_completion — a logged 0 is the best outcome", () => {
    // You cannot fail to not smoke. 0 is a success, and treating it as
    // the tri-state "explicit miss" would invert the whole habit.
    const entries = toEntryMap([makeEntry("2026-08-14", 0)]);
    expect(computeScore(limit(30), entries, "2026-08-14", "2026-08-14", TODAY)).toBe(100);
  });

  it("8. atmost_unlogged_is_missed — not logging is not staying under", () => {
    expect(computeScore(limit(30), toEntryMap([]), "2026-08-12", "2026-08-14", TODAY)).toBe(0);
  });

  it("exactly on target counts as met", () => {
    const entries = toEntryMap([makeEntry("2026-08-14", 30)]);
    expect(computeScore(limit(30), entries, "2026-08-14", "2026-08-14", TODAY)).toBe(100);
  });

  it("9. atmost_heatmap_inverts — a low value maps to a HIGHER shade", () => {
    // The gold ramp means "good", not "large".
    const good = computeHeatmap(limit(30), "2026-08-01",
      toEntryMap([makeEntry("2026-08-14", 2)]), TODAY, "2026-08");
    const bad = computeHeatmap(limit(30), "2026-08-01",
      toEntryMap([makeEntry("2026-08-14", 300)]), TODAY, "2026-08");
    const on = (days: typeof good) => days.find((d) => d.date === "2026-08-14")!.level;
    expect(on(good)).toBeGreaterThan(on(bad));
  });

  it("an at_most streak counts days under the limit", () => {
    const entries = toEntryMap([
      makeEntry("2026-08-12", 10), makeEntry("2026-08-13", 0), makeEntry("2026-08-14", 29),
    ]);
    expect(computeCurrentStreak(limit(30), "2026-08-12", entries, TODAY)).toBe(3);
  });
});

describe("10-14. scoring boundaries", () => {
  it("10. denominator_starts_at_first_history — a habit created on the 28th is not 10% for the month", () => {
    const h = makeHabit({ createdDate: "2026-08-12" });
    const done = entriesOn(["2026-08-12", "2026-08-13", "2026-08-14"]);
    // Three of three since it existed, not three of fourteen.
    expect(computeScore(h, done, "2026-08-12", TODAY, TODAY)).toBe(100);
  });

  it("11. period_before_history_returns_null — not zero", () => {
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [1], createdDate: "2026-01-01" });
    // A Monday-only habit over a Saturday-to-Sunday window has no
    // scheduled day, so it has no score. 0% would read as failure.
    expect(computeScoreOrNull(h, toEntryMap([]), "2026-08-15", "2026-08-16", TODAY)).toBeNull();
    expect(computeScoreOrNull(weekly(3), toEntryMap([]), "2026-08-20", "2026-08-14", TODAY)).toBeNull();
  });

  it("computeScore still collapses null to 0, in exactly one place", () => {
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [1], createdDate: "2026-01-01" });
    expect(computeScore(h, toEntryMap([]), "2026-08-15", "2026-08-16", TODAY)).toBe(0);
  });

  it("13. future_days_never_counted — in a denominator or as missed", () => {
    const h = makeHabit({ createdDate: "2026-08-10" });
    const done = entriesOn(["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]);
    // The window runs past today; only the elapsed part may count.
    expect(computeScore(h, done, "2026-08-10", "2026-08-31", TODAY)).toBe(100);
  });

  it("13b. a quota period reaching into the future is judged on elapsed days only", () => {
    // Friday, 3 of 3 done. The week still has Saturday and Sunday, but
    // the quota is already met and must read as met.
    const done = entriesOn(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(computeQuotaState(weekly(3), done, TODAY, TODAY).met).toBe(true);
    expect(computeScore(weekly(3), done, "2026-08-10", "2026-08-16", TODAY)).toBe(100);
  });

  it("14. backfilled_entry_included — an entry before created_at counts", () => {
    // Pins the Screen 2 gate bug permanently.
    const h = makeHabit({ createdDate: "2026-08-10" });
    const backfilled = entriesOn(["2026-08-01"]);
    expect(computeScoreOrNull(h, backfilled, "2026-08-01", "2026-08-01", TODAY)).toBe(100);
    expect(computeCurrentStreak(h, "2026-08-01", backfilled, "2026-08-01")).toBe(1);
  });

  it("4.5 an explicit miss and an unlogged day score identically", () => {
    const h = makeHabit({ createdDate: "2026-08-12" });
    const missed = toEntryMap([makeEntry("2026-08-13", 0)]);
    const unlogged = toEntryMap([]);
    expect(computeScore(h, missed, "2026-08-13", "2026-08-13", TODAY))
      .toBe(computeScore(h, unlogged, "2026-08-13", "2026-08-13", TODAY));
  });
});
