// Resolves the four period names every Layer 2 function accepts into a
// concrete [start,end] date range, anchored on "today".
//
// DECISION (spec doesn't fix this): all periods are rolling windows ending
// today, not calendar-aligned ones. A calendar-aligned "month" would reset
// to an empty 0%-looking score on the 1st of every month, which is a
// worse UX than a smooth 30-day trailing window — logged as a build
// decision, see the Layer 2 gate report.
//
// The range never starts before the habit existed (habitCreatedDateStr):
// a habit can't be scored on days before it was created. It deliberately
// is NOT clamped to the first *entry* date — days after creation with no
// entry are legitimately missed/unscheduled days and should count against
// the score, not be hidden from the denominator.
export type Period = "week" | "month" | "year" | "all";

import { addDays } from "./dateUtil.js";

export function resolvePeriodRange(period: Period, today: string, habitCreatedDateStr: string): { start: string; end: string } {
  if (period === "all") {
    return { start: habitCreatedDateStr, end: today };
  }
  const days = period === "week" ? 6 : period === "month" ? 29 : 364; // N-day trailing window incl. today
  const start = addDays(today, -days);
  return { start: start > habitCreatedDateStr ? start : habitCreatedDateStr, end: today };
}
