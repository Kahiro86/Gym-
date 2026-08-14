import { describe, it, expect } from "vitest";
import { describeFrequency, computeOverview } from "../../src/logic/detail.js";
import { dateRange } from "../../src/logic/dates.js";
import { makeHabit, makeEntry, startOf } from "./factories.js";

const TODAY = "2026-08-14";

const entriesFor = (dates: string[], value = 1) => dates.map((d) => makeEntry(d, value));

describe("describeFrequency", () => {
  it("describes a daily habit", () => {
    expect(describeFrequency(makeHabit({ frequencyType: "daily" }))).toBe("every day");
  });

  it("lists specific days in week order regardless of input order", () => {
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [5, 1, 3] });
    expect(describeFrequency(h)).toBe("Mon, Wed, Fri");
  });

  it("collapses all seven specific days to 'every day'", () => {
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(describeFrequency(h)).toBe("every day");
  });

  it("describes count-based frequencies", () => {
    expect(describeFrequency(makeHabit({ frequencyType: "times_per_week", frequencyCount: 3 })))
      .toBe("3× per week");
    expect(describeFrequency(makeHabit({ frequencyType: "times_per_month", frequencyCount: 10 })))
      .toBe("10× per month");
  });
});

describe("computeOverview", () => {
  const overview = (habit: ReturnType<typeof makeHabit>, entries: ReturnType<typeof entriesFor>, period: "week" | "month" | "year" | "all" = "month") =>
    computeOverview(habit, startOf(habit), entries, TODAY, period);

  it("returns zeroes for a habit with no entries, never NaN", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const o = overview(h, []);
    expect(o.score).toBe(0);
    expect(o.total).toBe(0);
    expect(Number.isNaN(o.score)).toBe(false);
  });

  it("counts total completions across the habit's whole life", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const o = overview(h, entriesFor(dateRange("2026-02-01", "2026-02-28")));
    expect(o.total).toBe(28);
  });

  it("excludes explicit misses from the total", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    const o = overview(h, [...entriesFor(["2026-03-01", "2026-03-02"]), makeEntry("2026-03-03", 0)]);
    expect(o.total).toBe(2);
  });

  it("excludes completions logged on unscheduled days from the total", () => {
    // Mondays only; 2026-08-11 is a Tuesday.
    const h = makeHabit({ createdDate: "2026-01-01", frequencyType: "specific_days", frequencyDays: [1] });
    const o = overview(h, entriesFor(["2026-08-10", "2026-08-11"]));
    expect(o.total).toBe(1);
  });

  it("follows the selected period for the ring score", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    // Perfect for the last 7 days only.
    const o = overview(h, entriesFor(dateRange("2026-08-08", "2026-08-14")), "week");
    expect(o.score).toBe(100);
    const monthly = overview(h, entriesFor(dateRange("2026-08-08", "2026-08-14")), "month");
    expect(monthly.score).toBeLessThan(100);
  });

  it("reports a positive month delta when the recent window improved", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    // Complete the trailing 30 days, nothing before.
    const o = overview(h, entriesFor(dateRange("2026-07-16", "2026-08-14")));
    expect(o.monthDelta).toBe(100);
  });

  it("reports a negative month delta when the recent window declined", () => {
    const h = makeHabit({ createdDate: "2026-01-01" });
    // Complete only the earlier window.
    const o = overview(h, entriesFor(dateRange("2026-06-16", "2026-07-15")));
    expect(o.monthDelta).toBeLessThan(0);
  });

  it("returns null deltas when the comparison window predates the habit", () => {
    // Created 10 days ago: there is no prior 30-day window to compare to.
    const h = makeHabit({ createdDate: "2026-08-05" });
    const o = overview(h, entriesFor(dateRange("2026-08-05", "2026-08-14")));
    expect(o.monthDelta).toBeNull();
    expect(o.yearDelta).toBeNull();
  });

  it("gives a year delta once the habit is old enough for one", () => {
    const h = makeHabit({ createdDate: "2024-01-01" });
    const o = overview(h, entriesFor(dateRange("2025-08-16", "2026-08-14")));
    expect(o.yearDelta).not.toBeNull();
    expect(o.yearDelta!).toBeGreaterThan(0);
  });

  it("keeps a numeric habit's below-target days out of the total", () => {
    const h = makeHabit({ createdDate: "2026-01-01", type: "numeric", target: 8, unit: "glasses" });
    const o = computeOverview(h, startOf(h), [
      makeEntry("2026-08-10", 8), makeEntry("2026-08-11", 10), makeEntry("2026-08-12", 3),
    ], TODAY, "month");
    expect(o.total).toBe(2);
  });
});
