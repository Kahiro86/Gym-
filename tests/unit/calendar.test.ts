import { describe, it, expect } from "vitest";
import { buildCalendarMonth, frequencyDots, describeDay, stepMonth, WEEK_DOT_LABELS } from "../../src/logic/calendar.js";
import { dateRange } from "../../src/logic/dates.js";
import { makeHabit, makeEntry, startOf } from "./factories.js";

const TODAY = "2026-08-14";
const entriesFor = (dates: string[], value = 1) => dates.map((d) => makeEntry(d, value));

describe("frequencyDots", () => {
  it("labels seven days Mon through Sun", () => {
    expect(WEEK_DOT_LABELS).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  it("lights every day for a daily habit", () => {
    expect(frequencyDots(makeHabit({ frequencyType: "daily" }))).toEqual(Array(7).fill(true));
  });

  it("lights only the scheduled weekdays, in Mon-first order", () => {
    // Mon/Wed/Fri -> mon, wed, fri lit; tue, thu, sat, sun dark.
    const mwf = makeHabit({ frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    expect(frequencyDots(mwf)).toEqual([true, false, true, false, true, false, false]);
  });

  it("puts Sunday last, not first", () => {
    const sundays = makeHabit({ frequencyType: "specific_days", frequencyDays: [0] });
    expect(frequencyDots(sundays)).toEqual([false, false, false, false, false, false, true]);
  });

  it("returns null for a count-based habit, which has no weekday pattern", () => {
    // This used to light all seven dots. Handoff A4 and Layer 2b §2.2
    // are explicit that the card is wrong for these habits either way:
    // all lit implies a daily schedule, none lit implies never due. The
    // screen shows "3× per week" in the dots' place instead.
    const weekly = makeHabit({ frequencyType: "times_per_week", frequencyCount: 3 });
    expect(frequencyDots(weekly)).toBeNull();
    expect(frequencyDots(makeHabit({ frequencyType: "times_per_month", frequencyCount: 10 }))).toBeNull();
  });
});

describe("buildCalendarMonth", () => {
  const habit = makeHabit({ createdDate: "2026-01-01" });
  const build = (month: string, entries = entriesFor([]), h = habit, today = TODAY) =>
    buildCalendarMonth(h, startOf(h), entries, today, month);

  it("aligns the 1st under its weekday with the right number of blanks", () => {
    // Every weekday a month can start on, so the alignment is proven
    // rather than sampled. Su=0, so the blank count IS the weekday index.
    const starts = {
      "2026-02": 0, // Sunday
      "2026-06": 1, // Monday
      "2026-09": 2, // Tuesday
      "2026-04": 3, // Wednesday
      "2026-01": 4, // Thursday
      "2026-05": 5, // Friday
      "2026-08": 6, // Saturday
    };
    for (const [month, blanks] of Object.entries(starts)) {
      expect(`${month}: ${build(month).leadingBlanks}`).toBe(`${month}: ${blanks}`);
      // The 1st has to land in the column the blanks point at.
      expect(build(month).days[0].date).toBe(`${month}-01`);
    }
  });

  it("emits one cell per day, including February in a leap year", () => {
    expect(build("2026-08").days).toHaveLength(31);
    expect(build("2026-02").days).toHaveLength(28);
    const leap = makeHabit({ createdDate: "2028-01-01" });
    expect(buildCalendarMonth(leap, startOf(leap), [], "2028-03-01", "2028-02").days).toHaveLength(29);
  });

  it("numbers the cells 1..n", () => {
    const days = build("2026-08").days;
    expect(days[0].day).toBe(1);
    expect(days[30].day).toBe(31);
  });

  it("marks today, and only today", () => {
    const days = build("2026-08").days;
    expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY]);
  });

  it("marks days after today as future", () => {
    const days = build("2026-08").days;
    expect(days.find((d) => d.date === "2026-08-15")!.inFuture).toBe(true);
    expect(days.find((d) => d.date === "2026-08-13")!.inFuture).toBe(false);
  });

  it("keeps a logged 0 distinct from nothing logged", () => {
    const days = build("2026-08", [makeEntry("2026-08-10", 0)]).days;
    expect(days.find((d) => d.date === "2026-08-10")!.value).toBe(0);
    expect(days.find((d) => d.date === "2026-08-11")!.value).toBeNull();
  });

  it("grades completed stretches above zero on the ramp", () => {
    const days = build("2026-08", entriesFor(dateRange("2026-08-01", "2026-08-14"))).days;
    expect(days.find((d) => d.date === TODAY)!.level).toBe(4);
    expect(days.every((d) => d.level >= 0 && d.level <= 4)).toBe(true);
  });

  it("flags days the habit is not due", () => {
    const mwf = makeHabit({ createdDate: "2026-01-01", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    const days = build("2026-08", [], mwf).days;
    // 2026-08-10 is a Monday, 2026-08-11 a Tuesday.
    expect(days.find((d) => d.date === "2026-08-10")!.scheduled).toBe(true);
    expect(days.find((d) => d.date === "2026-08-11")!.scheduled).toBe(false);
  });

  it("flags days before the habit's history began", () => {
    const late = makeHabit({ createdDate: "2026-08-10" });
    const days = build("2026-08", [], late).days;
    expect(days.find((d) => d.date === "2026-08-05")!.beforeStart).toBe(true);
    expect(days.find((d) => d.date === "2026-08-12")!.beforeStart).toBe(false);
  });

  it("stops backward navigation at the month the history starts in", () => {
    const h = makeHabit({ createdDate: "2026-08-01" });
    expect(build("2026-08", [], h).canGoBack).toBe(false);
    expect(build("2026-09", [], h, "2026-09-15").canGoBack).toBe(true);
  });

  it("stops forward navigation at the current month", () => {
    expect(build("2026-08").canGoForward).toBe(false);
    expect(build("2026-07").canGoForward).toBe(true);
  });
});

describe("stepMonth", () => {
  const habit = makeHabit({ createdDate: "2026-01-01" });
  const view = (month: string, today = TODAY) => buildCalendarMonth(habit, startOf(habit), [], today, month);

  it("moves back and forward a month", () => {
    expect(stepMonth(view("2026-07"), -1)).toBe("2026-06");
    expect(stepMonth(view("2026-07"), 1)).toBe("2026-08");
  });

  it("crosses a year boundary", () => {
    const h = makeHabit({ createdDate: "2025-01-01" });
    const v = buildCalendarMonth(h, startOf(h), [], TODAY, "2026-01");
    expect(stepMonth(v, -1)).toBe("2025-12");
  });

  it("refuses to move past the present or before the history", () => {
    expect(stepMonth(view("2026-08"), 1)).toBe("2026-08");
    const young = makeHabit({ createdDate: "2026-08-01" });
    const v = buildCalendarMonth(young, startOf(young), [], TODAY, "2026-08");
    expect(stepMonth(v, -1)).toBe("2026-08");
  });
});

describe("describeDay", () => {
  const day = (over: Partial<Parameters<typeof describeDay>[1]>) => ({
    date: "2026-08-10", day: 10, level: 0 as const, value: null,
    scheduled: true, isToday: false, inFuture: false, beforeStart: false, ...over,
  });

  it("describes boolean days", () => {
    const h = makeHabit({ type: "boolean" });
    expect(describeDay(h, day({ value: 1 }))).toBe("Completed");
    expect(describeDay(h, day({ value: 0 }))).toBe("Missed");
    expect(describeDay(h, day({ value: null }))).toBe("Not logged");
  });

  it("describes numeric days with their unit", () => {
    const h = makeHabit({ type: "numeric", target: 8, unit: "glasses" });
    expect(describeDay(h, day({ value: 6 }))).toBe("6 glasses");
    const noUnit = makeHabit({ type: "numeric", target: 8 });
    expect(describeDay(noUnit, day({ value: 6 }))).toBe("6");
  });

  it("does not call a future day 'not logged'", () => {
    expect(describeDay(makeHabit(), day({ value: null, inFuture: true }))).toBe("In the future");
  });
});
