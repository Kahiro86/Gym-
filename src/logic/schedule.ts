// "Was this day expected?" — the single definition of scheduling, used by
// scores, streaks, history and the heatmap alike (non-negotiable #4).
import type { Habit } from "../db/types.js";
import { dayOfWeek, dateRange, weekStart, monthOf } from "./dates.js";

/**
 * Whether `dateStr` is a day this habit is expected on.
 *
 * times_per_week / times_per_month have no fixed day pattern — any day is
 * a legitimate day to log them — so every day is "schedulable" and the
 * frequency instead constrains *how many* completions are expected, which
 * is handled by countScheduledDays below.
 */
export function isScheduled(habit: Habit, dateStr: string): boolean {
  switch (habit.frequencyType) {
    case "daily":
      return true;
    case "specific_days":
      return (habit.frequencyDays ?? []).includes(dayOfWeek(dateStr));
    case "times_per_week":
    case "times_per_month":
      return true;
  }
}

/**
 * The denominator for every score: how many completions [start, end]
 * should contain.
 *
 *   daily            → every day in range
 *   specific_days    → days whose weekday is listed
 *   times_per_week   → frequencyCount × distinct weeks overlapped
 *   times_per_month  → frequencyCount × distinct months overlapped
 *
 * The times_per_* cases prorate partial weeks/months by the fraction of
 * that week/month actually inside the range, rounded to a whole
 * expectation. Without prorating, a 7-day window landing across two
 * calendar weeks would demand 2×N completions for what is really one
 * week's worth of days, and every such score would read far too low.
 */
export function countScheduledDays(habit: Habit, start: string, end: string): number {
  if (start > end) return 0;
  const days = dateRange(start, end);

  switch (habit.frequencyType) {
    case "daily":
      return days.length;
    case "specific_days":
      return days.filter((d) => isScheduled(habit, d)).length;
    case "times_per_week":
      return proratedCount(habit.frequencyCount ?? 0, days, weekStart, 7);
    case "times_per_month":
      return proratedCount(habit.frequencyCount ?? 0, days, monthOf, null);
  }
}

/**
 * Sums `perBucket` scaled by how much of each bucket the range covers.
 * `bucketSize` is the bucket's fixed length in days, or null when it
 * varies (months) and must be derived from the data.
 */
function proratedCount(
  perBucket: number,
  days: string[],
  bucketKey: (d: string) => string,
  bucketSize: number | null,
): number {
  if (perBucket <= 0 || !days.length) return 0;
  const covered = new Map<string, number>();
  for (const d of days) {
    const key = bucketKey(d);
    covered.set(key, (covered.get(key) ?? 0) + 1);
  }
  let total = 0;
  for (const [key, coveredDays] of covered) {
    const size = bucketSize ?? daysInBucketMonth(key);
    total += perBucket * (coveredDays / size);
  }
  return Math.max(1, Math.round(total));
}

function daysInBucketMonth(yyyymm: string): number {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
