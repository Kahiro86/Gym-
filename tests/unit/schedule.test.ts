import { describe, it, expect } from "vitest";
import { isScheduled, countScheduledDays } from "../../src/logic/schedule.js";
import { isCompleted } from "../../src/logic/completion.js";
import { makeHabit, makeEntry } from "./factories.js";

describe("isScheduled", () => {
  it("schedules every day for a daily habit", () => {
    const h = makeHabit({ frequencyType: "daily" });
    expect(isScheduled(h, "2026-08-14")).toBe(true);
    expect(isScheduled(h, "2026-08-16")).toBe(true);
  });

  it("schedules only the listed weekdays for specific_days", () => {
    // Mon/Wed/Fri
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    expect(isScheduled(h, "2026-08-10")).toBe(true);  // Monday
    expect(isScheduled(h, "2026-08-11")).toBe(false); // Tuesday
    expect(isScheduled(h, "2026-08-12")).toBe(true);  // Wednesday
    expect(isScheduled(h, "2026-08-16")).toBe(false); // Sunday
  });

  it("treats every day as loggable for times_per_week/month", () => {
    const w = makeHabit({ frequencyType: "times_per_week", frequencyCount: 3 });
    const m = makeHabit({ frequencyType: "times_per_month", frequencyCount: 10 });
    expect(isScheduled(w, "2026-08-16")).toBe(true);
    expect(isScheduled(m, "2026-08-16")).toBe(true);
  });
});

describe("countScheduledDays", () => {
  it("counts every day for daily habits", () => {
    const h = makeHabit({ frequencyType: "daily" });
    expect(countScheduledDays(h, "2026-08-01", "2026-08-07")).toBe(7);
  });

  it("counts only matching weekdays for specific_days", () => {
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
    // 2026-08-10..16 is Mon..Sun -> Mon, Wed, Fri = 3
    expect(countScheduledDays(h, "2026-08-10", "2026-08-16")).toBe(3);
  });

  it("returns 0 when the window contains none of the scheduled weekdays", () => {
    const h = makeHabit({ frequencyType: "specific_days", frequencyDays: [1] }); // Mondays
    // 2026-08-11 (Tue) .. 2026-08-16 (Sun) contains no Monday
    expect(countScheduledDays(h, "2026-08-11", "2026-08-16")).toBe(0);
  });

  it("returns 0 for an inverted range rather than throwing", () => {
    const h = makeHabit();
    expect(countScheduledDays(h, "2026-08-10", "2026-08-01")).toBe(0);
  });

  it("expects exactly frequencyCount over one full week", () => {
    const h = makeHabit({ frequencyType: "times_per_week", frequencyCount: 3 });
    // A full Sun..Sat week.
    expect(countScheduledDays(h, "2026-08-09", "2026-08-15")).toBe(3);
  });

  it("prorates times_per_week across a week boundary instead of double-counting", () => {
    const h = makeHabit({ frequencyType: "times_per_week", frequencyCount: 3 });
    // A 7-day window straddling two calendar weeks is still one week of
    // days: without prorating this would demand 6 and halve the score.
    expect(countScheduledDays(h, "2026-08-12", "2026-08-18")).toBe(3);
  });

  it("expects exactly frequencyCount over one full month", () => {
    const h = makeHabit({ frequencyType: "times_per_month", frequencyCount: 12 });
    expect(countScheduledDays(h, "2026-08-01", "2026-08-31")).toBe(12);
  });

  it("prorates a partial month", () => {
    const h = makeHabit({ frequencyType: "times_per_month", frequencyCount: 30 });
    // Roughly half of a 31-day month -> about half the expectation.
    const n = countScheduledDays(h, "2026-08-01", "2026-08-15");
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(16);
  });

  it("never expects zero completions from a non-empty window", () => {
    const h = makeHabit({ frequencyType: "times_per_month", frequencyCount: 1 });
    // One day out of 31 prorates to 0.03, which must still round up to 1
    // rather than making the denominator zero.
    expect(countScheduledDays(h, "2026-08-14", "2026-08-14")).toBe(1);
  });
});

describe("isCompleted", () => {
  it("counts only value=1 for boolean habits", () => {
    const h = makeHabit({ type: "boolean" });
    expect(isCompleted(h, makeEntry("2026-08-14", 1))).toBe(true);
    expect(isCompleted(h, makeEntry("2026-08-14", 0))).toBe(false);
  });

  it("distinguishes an explicit miss from no row at all", () => {
    const h = makeHabit({ type: "boolean" });
    expect(isCompleted(h, makeEntry("2026-08-14", 0))).toBe(false);
    expect(isCompleted(h, null)).toBe(false);
    expect(isCompleted(h, undefined)).toBe(false);
  });

  it("applies an at_least target for numeric habits", () => {
    const h = makeHabit({ type: "numeric", target: 8, unit: "glasses", targetDirection: "at_least" });
    expect(isCompleted(h, makeEntry("2026-08-14", 8))).toBe(true);
    expect(isCompleted(h, makeEntry("2026-08-14", 9))).toBe(true);
    expect(isCompleted(h, makeEntry("2026-08-14", 7))).toBe(false);
  });

  it("applies an at_most target for numeric habits", () => {
    const h = makeHabit({ type: "numeric", target: 30, unit: "min", targetDirection: "at_most" });
    expect(isCompleted(h, makeEntry("2026-08-14", 30))).toBe(true);
    expect(isCompleted(h, makeEntry("2026-08-14", 10))).toBe(true);
    expect(isCompleted(h, makeEntry("2026-08-14", 45))).toBe(false);
  });

  it("counts a logged 0 as met for an at_most habit", () => {
    // "Spend at most 30 minutes scrolling" — zero minutes is a success,
    // and must not be mistaken for the boolean "missed" encoding.
    const h = makeHabit({ type: "numeric", target: 30, targetDirection: "at_most" });
    expect(isCompleted(h, makeEntry("2026-08-14", 0))).toBe(true);
  });
});
