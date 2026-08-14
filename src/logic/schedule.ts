// "Is this day scheduled for this habit?" and "how many scheduled days
// fall in this range?" — the single definition every score/streak/history
// function in this layer builds on (non-negotiable #4: one definition per
// concept, reused everywhere).
import type { Habit } from "../db/types.js";
import { dayOfWeek, weeksTouched, monthsTouched, dateRange } from "./dateUtil.js";

// times_per_week / times_per_month habits have no fixed day pattern, so
// every day is a "candidate" day for them — the frequency instead bounds
// how many completions are expected per week/month (see
// scheduledDaysInRange below), not which specific days count.
export function isScheduled(habit: Habit, dateStr: string): boolean {
  switch (habit.frequencyType) {
    case "daily": return true;
    case "specific_days": return (habit.frequencyDays ?? []).includes(dayOfWeek(dateStr));
    case "times_per_week": return true;
    case "times_per_month": return true;
  }
}

// The denominator for getScore/getHistory: how many "expected" days fall
// in [start,end], respecting the habit's frequency config rather than raw
// calendar days.
//
//   daily            -> every day in range
//   specific_days     -> days whose weekday is in frequencyDays
//   times_per_week    -> frequencyCount x (distinct Sunday-anchored weeks touched)
//   times_per_month   -> frequencyCount x (distinct months touched)
//
// The times_per_* cases are a documented judgment call (spec doesn't fix a
// formula for them): counting distinct calendar weeks/months touched
// (rather than prorating fractional weeks at the range's edges) keeps the
// number a whole, easily-tested integer, at the cost of slightly
// over-counting a range that starts/ends mid-week/month.
export function scheduledDaysInRange(habit: Habit, start: string, end: string): number {
  if (compareRange(start, end)) return 0;
  switch (habit.frequencyType) {
    case "daily": return dateRange(start, end).length;
    case "specific_days": return dateRange(start, end).filter((d) => isScheduled(habit, d)).length;
    case "times_per_week": return (habit.frequencyCount ?? 0) * weeksTouched(start, end).length;
    case "times_per_month": return (habit.frequencyCount ?? 0) * monthsTouched(start, end).length;
  }
}

function compareRange(start: string, end: string): boolean {
  return start > end;
}
