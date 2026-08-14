import type { Habit } from "../db/types.js";
import { addDays, instantToDateStr, maxDate, minDate } from "./dates.js";

export type Period = "week" | "month" | "year" | "all";

/** Trailing window lengths in days, inclusive of today. */
const WINDOW_DAYS: Record<Exclude<Period, "all">, number> = {
  week: 7,
  month: 30,
  year: 365,
};

/** The local calendar date the habit was created on. */
export function habitCreatedDate(habit: Habit): string {
  return instantToDateStr(habit.createdAt);
}

/**
 * The earliest date a habit can be judged from.
 *
 * Normally that is its creation date. But a user can backfill history —
 * the calendar's EDIT flow stores whatever date they pick, including
 * days before they created the habit. Anchoring on creation alone would
 * silently drop that work from every score, streak and chart, so the
 * first entry wins whenever it is older. This is what Layer 1's
 * getFirstEntryDate exists for.
 */
export function effectiveStart(habit: Habit, firstEntryDate: string | null): string {
  const created = habitCreatedDate(habit);
  return firstEntryDate ? minDate(created, firstEntryDate) : created;
}

/**
 * Turns a period name into a concrete [start, end].
 *
 * Periods are rolling windows ending today rather than calendar-aligned
 * ones: a calendar month would drop every score to near-zero on the 1st,
 * which reads as failure rather than as a fresh month.
 *
 * The window never begins before `start` — the habit cannot be judged on
 * days that predate its existence and its history alike. It is
 * deliberately NOT clamped forward to the most recent entry: days since
 * then with nothing logged are genuine misses and must stay in the
 * denominator, or a habit logged once and abandoned would read 100%.
 */
export function resolvePeriodRange(period: Period, today: string, start: string): { start: string; end: string } {
  if (period === "all") return { start, end: today };
  return { start: maxDate(addDays(today, -(WINDOW_DAYS[period] - 1)), start), end: today };
}
