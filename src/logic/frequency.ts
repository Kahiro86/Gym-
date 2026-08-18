// Layer 2b §2 — the two genuinely different shapes a habit can have.
//
// The schema offers four frequency types, and it is tempting to treat
// them as one shape with variations. They are not. `daily` and
// `specific_days` have a per-day answer to "was this due?"; `3× a week`
// does not, and never will. Asking a quota habit whether Tuesday was
// "scheduled" has no correct answer, so the previous implementation
// answered "yes, every day" and prorated the denominator — which produces
// numbers that look plausible and are wrong.
//
// The distinction is a named function and a named type precisely so it
// cannot be buried inside a branch of something larger.
import type { Habit, Entry } from "../db/types.js";
import {
  addDays, dateRange, dayOfWeek, monthOf, firstOfMonth, lastOfMonth, shiftMonth, minDate, maxDate,
} from "./dates.js";
import { isCompleted } from "./completion.js";

export type FrequencyShape = "scheduled" | "quota";

/**
 * Which of the two shapes a habit has.
 *
 * Every function whose maths differs between them branches on this and
 * nothing else, so "does this code path handle quota habits?" is always
 * answerable by looking for the call.
 */
export function getFrequencyShape(habit: Habit): FrequencyShape {
  switch (habit.frequencyType) {
    case "daily":
    case "specific_days":
      return "scheduled";
    case "times_per_week":
    case "times_per_month":
      return "quota";
  }
}

/** The unit a quota is counted over. Weeks run Mon-Sun (§2.2). */
export type QuotaUnit = "week" | "month";

export function quotaUnit(habit: Habit): QuotaUnit {
  return habit.frequencyType === "times_per_month" ? "month" : "week";
}

/** How many completions the habit's own config asks for per period. */
export function quotaRequired(habit: Habit): number {
  return Math.max(1, habit.frequencyCount ?? 1);
}

export interface QuotaPeriod {
  start: string;
  end: string;
}

/**
 * The Monday beginning `date`'s week.
 *
 * Deliberately NOT dates.ts's weekStart, which is Sunday-based and is
 * used by the history buckets. §2.2 requires Mon-Sun for quota periods
 * because that is how people say "this week", and changing the shared
 * helper would silently move every history bar as well.
 */
function mondayOf(date: string): string {
  // dayOfWeek is 0 for Sunday, so Sunday steps back six days, not zero.
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** The period containing `date`, in whole calendar units. */
export function periodContaining(habit: Habit, date: string): QuotaPeriod {
  if (quotaUnit(habit) === "month") {
    return { start: firstOfMonth(monthOf(date)), end: lastOfMonth(monthOf(date)) };
  }
  const start = mondayOf(date);
  return { start, end: addDays(start, 6) };
}

export function shiftPeriod(habit: Habit, period: QuotaPeriod, delta: number): QuotaPeriod {
  if (quotaUnit(habit) === "month") {
    const m = shiftMonth(monthOf(period.start), delta);
    return { start: firstOfMonth(m), end: lastOfMonth(m) };
  }
  const start = addDays(period.start, delta * 7);
  return { start, end: addDays(start, 6) };
}

/** Whole periods overlapping [start, end], oldest first. */
export function periodsBetween(habit: Habit, start: string, end: string): QuotaPeriod[] {
  if (start > end) return [];
  const out: QuotaPeriod[] = [];
  let p = periodContaining(habit, start);
  // A period whose whole span is before the habit began is not a period
  // the habit could have failed.
  while (p.start <= end) {
    out.push(p);
    p = shiftPeriod(habit, p, 1);
  }
  return out;
}

export interface QuotaState {
  required: number;
  completed: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
  met: boolean;
  /** True while the period is still running — it cannot have failed yet. */
  inProgress: boolean;
}

/**
 * How a quota habit stands in the period containing `date`.
 *
 * §2.2 is explicit that "is it due today?" has no correct answer for
 * these habits, and that the UI should be handed this instead of a
 * boolean it would have to invent meaning for.
 */
export function computeQuotaState(
  habit: Habit, entries: ReadonlyMap<string, Entry>, date: string, today: string,
): QuotaState {
  const period = periodContaining(habit, date);
  const required = quotaRequired(habit);
  // Only elapsed days can have been completed; counting into the future
  // would be counting days that have not happened (§4.4).
  const countUntil = minDate(period.end, today);
  let completed = 0;
  if (period.start <= countUntil) {
    for (const d of dateRange(period.start, countUntil)) {
      if (isCompleted(habit, entries.get(d))) completed++;
    }
  }
  return {
    required,
    completed,
    remaining: Math.max(0, required - completed),
    periodStart: period.start,
    periodEnd: period.end,
    met: completed >= required,
    inProgress: today >= period.start && today <= period.end,
  };
}

/**
 * Completed ÷ required for the period, capped at 100 (§2.2).
 *
 * Doing five of a three-a-week habit is not 167% of a week; the quota is
 * the whole of what was asked for.
 */
export function computeQuotaPeriodScore(
  habit: Habit, entries: ReadonlyMap<string, Entry>, period: QuotaPeriod, today: string,
): number {
  const state = computeQuotaStateForPeriod(habit, entries, period, today);
  return Math.min(100, Math.round((100 * state.completed) / state.required));
}

function computeQuotaStateForPeriod(
  habit: Habit, entries: ReadonlyMap<string, Entry>, period: QuotaPeriod, today: string,
): QuotaState {
  return computeQuotaState(habit, entries, period.start, today);
}

/**
 * Score across an arbitrary range, as the mean of the periods it covers.
 *
 * The in-progress period is included — a week half-done is genuinely
 * half-done — but it is prorated by how much of it has elapsed, so
 * Monday morning does not drag the month's score to the floor.
 */
export function computeQuotaScore(
  habit: Habit, entries: ReadonlyMap<string, Entry>, start: string, end: string, today: string,
): number | null {
  const periods = periodsBetween(habit, start, minDate(end, today));
  if (!periods.length) return null;

  let earned = 0;
  let possible = 0;
  for (const p of periods) {
    const state = computeQuotaState(habit, entries, p.start, today);
    // Prorate both sides by the fraction of the period inside the range
    // and already elapsed, so a partial period counts partially rather
    // than demanding a full quota from three days.
    const from = maxDate(p.start, start);
    const to = minDate(minDate(p.end, end), today);
    if (from > to) continue;
    const span = dateRange(p.start, p.end).length;
    const covered = dateRange(from, to).length;
    const weight = covered / span;
    earned += Math.min(state.completed, state.required) * weight;
    possible += state.required * weight;
  }
  if (possible <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((100 * earned) / possible)));
}

/**
 * Consecutive periods, ending at the most recent COMPLETED one, in which
 * the quota was met (§2.2).
 *
 * The in-progress period is never counted as broken. Tuesday with 0 of 3
 * has not failed; it is unfinished. Counting it would report streak 0 for
 * most of every week on every quota habit — the exact failure §2.2 calls
 * out. It can still *extend* the streak once the quota is actually met.
 */
export function computeQuotaStreak(
  habit: Habit, start: string, entries: ReadonlyMap<string, Entry>, today: string,
): number {
  if (today < start) return 0;

  const current = periodContaining(habit, today);
  let streak = 0;

  // The current period only adds to the streak, never breaks it.
  if (computeQuotaState(habit, entries, today, today).met) streak++;

  // Then walk backwards through completed periods until one fell short.
  let p = shiftPeriod(habit, current, -1);
  while (p.end >= start) {
    if (!computeQuotaState(habit, entries, p.start, today).met) break;
    streak++;
    p = shiftPeriod(habit, p, -1);
  }
  return streak;
}

export interface QuotaRun {
  startDate: string;
  endDate: string;
  /** Periods, not days — the only coherent unit for these habits. */
  length: number;
}

/**
 * Every maximal run of consecutive periods that met quota, longest first.
 *
 * The in-progress period is included only if its quota is already met,
 * for the same reason as above: it has not failed, so it must not end a
 * run that is still alive.
 */
export function computeQuotaBestRuns(
  habit: Habit, start: string, entries: ReadonlyMap<string, Entry>, today: string, limit: number,
): QuotaRun[] {
  if (today < start || limit <= 0) return [];
  const runs: QuotaRun[] = [];
  let open: QuotaPeriod | null = null;
  let last: QuotaPeriod | null = null;
  let length = 0;

  for (const p of periodsBetween(habit, start, today)) {
    const state = computeQuotaState(habit, entries, p.start, today);
    if (state.met) {
      open ??= p;
      last = p;
      length++;
    } else if (state.inProgress) {
      // Unfinished: neither extends nor ends the run. Leaving it open is
      // what stops "3 weeks" becoming "0 weeks" every Monday morning.
      continue;
    } else if (open) {
      runs.push({ startDate: open.start, endDate: last!.end, length });
      open = null;
      length = 0;
    }
  }
  if (open) runs.push({ startDate: open.start, endDate: last!.end, length });

  return runs
    .sort((a, b) => b.length - a.length || (a.startDate < b.startDate ? -1 : 1))
    .slice(0, limit);
}

/** Human phrasing for a quota, e.g. "3× per week". */
export function describeQuota(habit: Habit): string {
  return `${quotaRequired(habit)}× per ${quotaUnit(habit)}`;
}
