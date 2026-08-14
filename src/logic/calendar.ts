// The view models behind Screen 3 (calendar and streaks).
import type { Db, Habit, Entry } from "../db/types.js";
import { dateRange, firstOfMonth, lastOfMonth, dayOfWeek, monthOf, shiftMonth } from "./dates.js";
import { isScheduled } from "./schedule.js";
import { isCompleted } from "./completion.js";
import { toEntryMap, computeHeatmap, computeBestStreaks, spanForHeatmap, type StreakRun } from "./core.js";
import { effectiveStart } from "./period.js";

/** Monday-first, matching the frequency row's Mon-Sun labels. */
export const WEEK_DOTS_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEK_DOT_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Which weekdays this habit is due on, Mon-Sun, for the frequency dots. */
export function frequencyDots(habit: Habit): boolean[] {
  // A count-based habit has no fixed weekday pattern — any day counts —
  // so every dot is lit rather than implying a schedule it does not have.
  if (habit.frequencyType === "times_per_week" || habit.frequencyType === "times_per_month") {
    return WEEK_DOTS_ORDER.map(() => true);
  }
  if (habit.frequencyType === "daily") return WEEK_DOTS_ORDER.map(() => true);
  const days = habit.frequencyDays ?? [];
  return WEEK_DOTS_ORDER.map((d) => days.includes(d));
}

export interface CalendarDay {
  date: string;
  /** Day of month, for the cell's number. */
  day: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** null when nothing is logged — distinct from a logged 0. */
  value: number | null;
  scheduled: boolean;
  isToday: boolean;
  inFuture: boolean;
  /** Before the habit's history began. */
  beforeStart: boolean;
}

export interface CalendarMonth {
  month: string;
  /** Empty cells before the 1st, so it lands under its weekday. */
  leadingBlanks: number;
  days: CalendarDay[];
  /** False once the month reaches the habit's first data. */
  canGoBack: boolean;
  canGoForward: boolean;
}

export function buildCalendarMonth(
  habit: Habit, start: string, entries: readonly Entry[], today: string, month: string,
): CalendarMonth {
  const map = toEntryMap(entries);
  const levels = new Map(computeHeatmap(habit, start, map, today, month).map((d) => [d.date, d.level]));
  const days: CalendarDay[] = dateRange(firstOfMonth(month), lastOfMonth(month)).map((date) => {
    const entry = map.get(date);
    return {
      date,
      day: Number(date.slice(8)),
      level: levels.get(date) ?? 0,
      value: entry ? entry.value : null,
      scheduled: isScheduled(habit, date),
      isToday: date === today,
      inFuture: date > today,
      beforeStart: date < start,
    };
  });
  return {
    month,
    leadingBlanks: dayOfWeek(firstOfMonth(month)),
    days,
    canGoBack: month > monthOf(start),
    canGoForward: month < monthOf(today),
  };
}

/** How a day reads in the cell popover. */
export function describeDay(habit: Habit, day: CalendarDay): string {
  if (day.value === null) return day.inFuture ? "In the future" : "Not logged";
  if (habit.type === "numeric") return `${day.value}${habit.unit ? ` ${habit.unit}` : ""}`;
  return isCompleted(habit, { value: day.value } as Entry) ? "Completed" : "Missed";
}

// ── Facades ───────────────────────────────────────────────────────────

async function loadHabit(db: Db, habitId: string) {
  const [habit, today, firstEntry] = await Promise.all([
    db.getHabit(habitId), db.getToday(), db.getFirstEntryDate(habitId),
  ]);
  return { habit, today, start: effectiveStart(habit, firstEntry) };
}

export async function getCalendarMonth(db: Db, habitId: string, month?: string): Promise<CalendarMonth & { habit: Habit }> {
  const { habit, today, start } = await loadHabit(db, habitId);
  const target = month ?? monthOf(today);
  const span = spanForHeatmap(start, target);
  const entries = await db.getEntriesForHabit(habitId, span.start, span.end);
  return { ...buildCalendarMonth(habit, start, entries, today, target), habit };
}

export interface StreaksView {
  runs: StreakRun[];
  /** Longest run, so bars can be sized proportionally. */
  longest: number;
  dots: boolean[];
  habit: Habit;
}

export async function getStreaksView(db: Db, habitId: string, limit = 5): Promise<StreaksView> {
  const { habit, today, start } = await loadHabit(db, habitId);
  const entries = await db.getEntriesForHabit(habitId, start, today);
  const runs = computeBestStreaks(habit, start, toEntryMap(entries), today, limit);
  return { runs, longest: runs.length ? runs[0].length : 0, dots: frequencyDots(habit), habit };
}

/** Month navigation, clamped so it cannot run past the data or the present. */
export function stepMonth(view: CalendarMonth, delta: -1 | 1): string {
  if (delta === -1 && !view.canGoBack) return view.month;
  if (delta === 1 && !view.canGoForward) return view.month;
  return shiftMonth(view.month, delta);
}
