// getHeatmapData — per-day 0-4 intensity for the Calendar screen's
// 5-step heatmap ramp (spec §2, Screen 3A).
//
// DECISION (spec doesn't fix what "intensity" means for a single day): a
// boolean habit's single day is inherently binary (done/not), which would
// make the calendar just two colors instead of graded ones. Each day's
// level instead reflects a trailing-7-day rolling score ending that day
// (same rolling-window idea as the trend line), bucketed into 5 steps —
// this shows *consistency* over the ramp, matching how Loop's own
// calendar reads (sparse logging looks duller than a tight streak, not
// just "logged" vs "not").
import type { Db } from "../db/types.js";
import { addDays, isoInstantToLocalDateStr, daysInMonth } from "./dateUtil.js";
import { getScoreForRange } from "./score.js";

export interface HeatmapDay {
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
}

const ROLLING_WINDOW_DAYS = 7;

export async function getHeatmapData(db: Db, habitId: string, month: string): Promise<HeatmapDay[]> {
  const habit = await db.getHabit(habitId);
  const today = await db.getToday();
  const createdDate = isoInstantToLocalDateStr(habit.createdAt);
  const count = daysInMonth(month);

  const out: HeatmapDay[] = [];
  for (let d = 1; d <= count; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    if (date > today || date < createdDate) {
      out.push({ date, level: 0 });
      continue;
    }
    const windowStart = addDays(date, -(ROLLING_WINDOW_DAYS - 1));
    const subStart = windowStart < createdDate ? createdDate : windowStart;
    const score = await getScoreForRange(db, habit, subStart, date);
    const level = (score === 0 ? 0 : Math.min(4, Math.ceil(score / 25))) as HeatmapDay["level"];
    out.push({ date, level });
  }
  return out;
}
