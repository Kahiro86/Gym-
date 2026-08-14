// getScore / getScoreColor — the single definition of "how well is this
// habit going", reused by the overview ring, history bars, trend line, and
// calendar heatmap.
//
// FORMULA (written down per spec §4):
//   score = round(100 * completions / scheduledDays)
//   - boolean habits:  completions = entries with value=1 on a scheduled day
//   - numeric habits:  completions = entries meeting target (per
//                       targetDirection) on a scheduled day
//   - scheduledDays respects the habit's frequency config (schedule.ts),
//     not raw calendar days
//   - scheduledDays === 0 (e.g. a specific_days habit whose window
//     contains none of its scheduled weekdays) -> score is 0, not NaN
import type { Db, Habit } from "../db/types.js";
import { isoInstantToLocalDateStr } from "./dateUtil.js";
import { resolvePeriodRange, type Period } from "./period.js";
import { scheduledDaysInRange, isScheduled } from "./schedule.js";
import { isCompleted } from "./completion.js";

export async function getScore(db: Db, habitId: string, period: Period): Promise<number> {
  const habit = await db.getHabit(habitId);
  const today = await db.getToday();
  return getScoreForHabit(db, habit, period, today);
}

// Internal helper shared with trend/history/heatmap, which already have
// `habit` and `today` in hand and shouldn't re-fetch them per data point.
export async function getScoreForHabit(db: Db, habit: Habit, period: Period, today: string): Promise<number> {
  const createdDate = isoInstantToLocalDateStr(habit.createdAt);
  const { start, end } = resolvePeriodRange(period, today, createdDate);
  return getScoreForRange(db, habit, start, end);
}

// Shared by getScoreForRange and getHistory's bar counts — one definition
// of "how many days in this range count as completed".
export async function countCompletions(db: Db, habit: Habit, start: string, end: string): Promise<number> {
  if (start > end) return 0;
  const entries = await db.getEntriesForHabit(habit.id, start, end);
  return entries.filter((e) => isCompleted(habit, e) && isScheduled(habit, e.date)).length;
}

export async function getScoreForRange(db: Db, habit: Habit, start: string, end: string): Promise<number> {
  if (start > end) return 0;
  const scheduledDays = scheduledDaysInRange(habit, start, end);
  if (scheduledDays === 0) return 0;
  const completions = await countCompletions(db, habit, start, end);
  return Math.max(0, Math.min(100, Math.round((100 * completions) / scheduledDays)));
}

export function getScoreColor(score: number): "success-green" | "accent-gold" | "danger-red" {
  if (score >= 70) return "success-green";
  if (score >= 40) return "accent-gold";
  return "danger-red";
}

// Hex values from spec §2 — kept alongside the token-name function above
// so callers can go straight to a paintable color without a second lookup
// table living somewhere else (one definition, one place).
export const SCORE_COLOR_HEX: Record<ReturnType<typeof getScoreColor>, string> = {
  "success-green": "#7BC862",
  "accent-gold": "#D4A843",
  "danger-red": "#E05252",
};
