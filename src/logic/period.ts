import type { Habit } from "../db/types.js";
import { addDays, instantToDateStr, maxDate } from "./dates.js";

export type Period = "week" | "month" | "year" | "all";

/** Trailing window lengths in days, inclusive of today. */
const WINDOW_DAYS: Record<Exclude<Period, "all">, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export function habitStartDate(habit: Habit): string {
  return instantToDateStr(habit.createdAt);
}

/**
 * Turns a period name into a concrete [start, end].
 *
 * Periods are rolling windows ending today rather than calendar-aligned
 * ones: a calendar month would drop every score to near-zero on the 1st,
 * which reads as failure rather than as a fresh month.
 *
 * The window never starts before the habit existed — a habit cannot be
 * judged on days that predate it. It is deliberately NOT clamped to the
 * first *entry* instead: days after creation that were never logged are
 * genuine misses and must stay in the denominator, or a habit logged once
 * and abandoned would show 100%.
 */
export function resolvePeriodRange(period: Period, today: string, habit: Habit): { start: string; end: string } {
  const created = habitStartDate(habit);
  if (period === "all") return { start: created, end: today };
  return { start: maxDate(addDays(today, -(WINDOW_DAYS[period] - 1)), created), end: today };
}
