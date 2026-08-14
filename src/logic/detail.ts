// The view models behind Screen 2 (habit detail).
//
// As with the list, the interpretation lives here rather than in the
// component: what "this month" means, when a delta is unknowable, and
// how a frequency config reads in words are all domain questions.
import type { Db, Habit, Entry } from "../db/types.js";
import { addDays, maxDate } from "./dates.js";
import { isScheduled } from "./schedule.js";
import { isCompleted } from "./completion.js";
import {
  toEntryMap, computeScore, computeCurrentStreak, computeBestStreaks,
  type EntryMap, type DateSpan,
} from "./core.js";
import { effectiveStart, type Period } from "./period.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The frequency config in words, for the header's meta row. */
export function describeFrequency(habit: Habit): string {
  switch (habit.frequencyType) {
    case "daily":
      return "every day";
    case "specific_days": {
      const days = [...(habit.frequencyDays ?? [])].sort((a, b) => a - b);
      if (days.length === 7) return "every day";
      return days.map((d) => DAY_NAMES[d]).join(", ");
    }
    case "times_per_week":
      return `${habit.frequencyCount}× per week`;
    case "times_per_month":
      return `${habit.frequencyCount}× per month`;
  }
}

export interface DetailHeader {
  habit: Habit;
  frequencyLabel: string;
  currentStreak: number;
  bestStreak: number;
}

export interface Overview {
  /** Score over the card's selected period. */
  score: number;
  /**
   * Change against the immediately preceding window of the same length.
   * null when that window falls entirely before the habit's history —
   * there is nothing to compare against, and showing "+97%" for a period
   * that did not exist yet would be inventing a result.
   */
  monthDelta: number | null;
  yearDelta: number | null;
  /** Completions across the habit's whole history. */
  total: number;
}

/** Everything the detail screen reads lives between `start` and today. */
export function spanForDetail(start: string, today: string): DateSpan {
  return { start, end: today };
}

function totalCompletions(habit: Habit, entries: readonly Entry[]): number {
  return entries.filter((e) => isScheduled(habit, e.date) && isCompleted(habit, e)).length;
}

/**
 * Score now versus the window immediately before it, both `days` long.
 * Returns null when the earlier window predates the habit's history.
 */
function delta(habit: Habit, start: string, entries: EntryMap, today: string, days: number): number | null {
  const currentStart = addDays(today, -(days - 1));
  const priorEnd = addDays(currentStart, -1);
  if (priorEnd < start) return null;
  const priorStart = maxDate(addDays(priorEnd, -(days - 1)), start);
  const current = computeScore(habit, entries, maxDate(currentStart, start), today);
  const prior = computeScore(habit, entries, priorStart, priorEnd);
  return current - prior;
}

function periodBounds(start: string, today: string, period: Period): [string, string] {
  if (period === "all") return [start, today];
  const days = period === "week" ? 7 : period === "month" ? 30 : 365;
  return [maxDate(addDays(today, -(days - 1)), start), today];
}

export function computeOverview(
  habit: Habit, start: string, entries: readonly Entry[], today: string, period: Period,
): Overview {
  const map = toEntryMap(entries);
  return {
    score: computeScore(habit, map, ...periodBounds(start, today, period)),
    monthDelta: delta(habit, start, map, today, 30),
    yearDelta: delta(habit, start, map, today, 365),
    total: totalCompletions(habit, entries),
  };
}

// ── Facades ───────────────────────────────────────────────────────────

async function loadDetail(db: Db, habitId: string) {
  const [habit, today, firstEntry] = await Promise.all([
    db.getHabit(habitId), db.getToday(), db.getFirstEntryDate(habitId),
  ]);
  const start = effectiveStart(habit, firstEntry);
  const span = spanForDetail(start, today);
  const entries = await db.getEntriesForHabit(habitId, span.start, span.end);
  return { habit, start, today, entries };
}

export async function getDetailHeader(db: Db, habitId: string): Promise<DetailHeader> {
  const { habit, start, today, entries } = await loadDetail(db, habitId);
  const map = toEntryMap(entries);
  const best = computeBestStreaks(habit, start, map, today, 1);
  return {
    habit,
    frequencyLabel: describeFrequency(habit),
    currentStreak: computeCurrentStreak(habit, start, map, today),
    bestStreak: best.length ? best[0].length : 0,
  };
}

export async function getOverview(db: Db, habitId: string, period: Period): Promise<Overview> {
  const { habit, start, today, entries } = await loadDetail(db, habitId);
  return computeOverview(habit, start, entries, today, period);
}
