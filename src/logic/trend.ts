// getScoreTrend — a time series for the trend line.
//
// DECISION (spec asks for "a time series", doesn't fix resolution): each
// point is a *rolling* score over a short trailing sub-window ending at
// that point, not the single day's raw completion — a boolean habit's
// single-day value is just 0/100, which would make the line look like
// noise. Resolution and sub-window widen together as the period grows:
//
//   week  -> 1 point/day  over the trailing 7 days,  each a 3-day  rolling score
//   month -> 1 point/day  over the trailing 30 days, each a 7-day  rolling score
//   year  -> 1 point/month over the trailing 12 months, each a 30-day rolling score
//   all   -> 1 point/month from the habit's creation month to now, each a 30-day rolling score
//
// Every point range is clipped to the habit's creation date, so a
// brand-new habit naturally yields a short series — the UI's "fewer than
// 2 points -> not enough data" rule (spec Screen 2C) falls out of this
// automatically rather than needing a separate empty-case branch here.
import type { Db } from "../db/types.js";
import { addDays, dateRange, isoInstantToLocalDateStr, monthsTouched, daysInMonth } from "./dateUtil.js";
import { getScoreForRange } from "./score.js";
import type { Period } from "./period.js";

export interface TrendPoint {
  date: string;
  score: number;
}

export async function getScoreTrend(db: Db, habitId: string, period: Period): Promise<TrendPoint[]> {
  const habit = await db.getHabit(habitId);
  const today = await db.getToday();
  const createdDate = isoInstantToLocalDateStr(habit.createdAt);
  if (today < createdDate) return [];

  let pointDates: string[];
  let subWindowDays: number;

  if (period === "week" || period === "month") {
    const back = period === "week" ? 6 : 29;
    subWindowDays = period === "week" ? 3 : 7;
    const start = clampToCreated(addDays(today, -back), createdDate);
    pointDates = dateRange(start, today);
  } else {
    subWindowDays = 30;
    const monthsBack = period === "year" ? 12 : Infinity;
    const earliestMonthStart = period === "year" ? addDays(today, -365) : createdDate;
    const start = clampToCreated(earliestMonthStart, createdDate);
    const months = monthsTouched(start, today).slice(monthsBack === Infinity ? 0 : -monthsBack);
    pointDates = months.map((ym) => {
      const lastDay = `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
      return lastDay > today ? today : lastDay;
    });
  }

  const points: TrendPoint[] = [];
  for (const date of pointDates) {
    const subStart = clampToCreated(addDays(date, -(subWindowDays - 1)), createdDate);
    const score = await getScoreForRange(db, habit, subStart, date);
    points.push({ date, score });
  }
  return points;
}

function clampToCreated(dateStr: string, createdDate: string): string {
  return dateStr < createdDate ? createdDate : dateStr;
}
