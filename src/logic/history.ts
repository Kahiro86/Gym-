// getHistory — per-bucket completion counts for the History bar chart
// (spec Screen 2D).
//
// DECISION (spec doesn't fix bucket count): `period` selects the BUCKET
// SIZE, not a total window — "week" buckets by calendar week (last 8
// buckets), "month" buckets by calendar month (last 6 buckets), matching
// the bar counts in the Loop-layout mockup. Buckets before the habit
// existed are never generated (there's nothing to show), so a young habit
// simply returns fewer buckets rather than padding with empty ones.
//
// A bucket is "met" (gold in the UI) using the exact same >=70 threshold
// getScoreColor uses for "success-green" — one definition of "good", not
// a second unrelated cutoff invented just for bars.
import type { Db } from "../db/types.js";
import { isoInstantToLocalDateStr, weekStart, addDays, monthOf, firstOfMonth, daysInMonth, shiftMonth, compareDateStr } from "./dateUtil.js";
import { countCompletions, getScoreForRange } from "./score.js";
import type { Period } from "./period.js";

export interface HistoryBucket {
  start: string;
  end: string;
  count: number;
  met: boolean;
}

const WEEK_BUCKETS = 8;
const MONTH_BUCKETS = 6;

export async function getHistory(db: Db, habitId: string, period: Extract<Period, "week" | "month">): Promise<HistoryBucket[]> {
  const habit = await db.getHabit(habitId);
  const today = await db.getToday();
  const createdDate = isoInstantToLocalDateStr(habit.createdAt);
  if (today < createdDate) return [];

  const bucketRanges: { start: string; end: string }[] = [];
  if (period === "week") {
    let cursor = weekStart(today);
    while (bucketRanges.length < WEEK_BUCKETS && compareDateStr(addDays(cursor, 6), createdDate) >= 0) {
      const start = compareDateStr(cursor, createdDate) < 0 ? createdDate : cursor;
      const end = addDays(cursor, 6) > today ? today : addDays(cursor, 6);
      bucketRanges.unshift({ start, end });
      cursor = addDays(cursor, -7);
    }
  } else {
    let cursorMonth = monthOf(today);
    const createdMonth = monthOf(createdDate);
    while (bucketRanges.length < MONTH_BUCKETS) {
      const monthStart = firstOfMonth(cursorMonth);
      const monthEnd = `${cursorMonth}-${String(daysInMonth(cursorMonth)).padStart(2, "0")}`;
      const start = compareDateStr(monthStart, createdDate) < 0 ? createdDate : monthStart;
      const end = compareDateStr(monthEnd, today) > 0 ? today : monthEnd;
      if (compareDateStr(start, end) <= 0) bucketRanges.unshift({ start, end });
      if (cursorMonth === createdMonth) break;
      cursorMonth = shiftMonth(cursorMonth, -1);
    }
  }

  const buckets: HistoryBucket[] = [];
  for (const { start, end } of bucketRanges) {
    const count = await countCompletions(db, habit, start, end);
    const score = await getScoreForRange(db, habit, start, end);
    buckets.push({ start, end, count, met: score >= 70 });
  }
  return buckets;
}
