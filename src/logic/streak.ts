// getCurrentStreak / getBestStreaks — both built on one shared run-finder
// (computeStreakRuns) so "what counts as a streak" has a single definition
// (non-negotiable #4), not two subtly-different implementations.
//
// A run is a maximal sequence of SCHEDULED days that were all completed;
// non-scheduled days are skipped over without starting, extending, or
// breaking a run (per spec: "A non-scheduled day does not break a streak").
import type { Db, Entry, Habit } from "../db/types.js";
import { addDays, dateRange, isoInstantToLocalDateStr } from "./dateUtil.js";
import { isScheduled } from "./schedule.js";
import { isCompleted } from "./completion.js";

export interface StreakRun {
  startDate: string;
  endDate: string;
  length: number;
}

function computeStreakRuns(habit: Habit, entries: Map<string, Entry>, start: string, end: string): StreakRun[] {
  if (start > end) return [];
  const runs: StreakRun[] = [];
  let runStart: string | null = null;
  let runEnd: string | null = null;
  let runLen = 0;
  for (const date of dateRange(start, end)) {
    if (!isScheduled(habit, date)) continue;
    if (isCompleted(habit, entries.get(date) ?? null)) {
      if (runStart === null) runStart = date;
      runEnd = date;
      runLen++;
    } else {
      if (runStart !== null) runs.push({ startDate: runStart, endDate: runEnd as string, length: runLen });
      runStart = null; runEnd = null; runLen = 0;
    }
  }
  if (runStart !== null) runs.push({ startDate: runStart, endDate: runEnd as string, length: runLen });
  return runs;
}

async function loadEntryMap(db: Db, habitId: string, start: string, end: string): Promise<Map<string, Entry>> {
  const map = new Map<string, Entry>();
  if (start > end) return map;
  for (const e of await db.getEntriesForHabit(habitId, start, end)) map.set(e.date, e);
  return map;
}

// Consecutive scheduled days completed up to today. If today is a
// scheduled day that simply hasn't been logged yet, the streak is not
// considered broken — the day isn't over. (Documented decision: this is
// the standard habit-tracker convention and the spec doesn't rule on it
// explicitly.)
export async function getCurrentStreak(db: Db, habitId: string): Promise<number> {
  const habit = await db.getHabit(habitId);
  const today = await db.getToday();
  const createdDate = isoInstantToLocalDateStr(habit.createdAt);
  if (today < createdDate) return 0;
  const yesterday = addDays(today, -1);
  const entries = await loadEntryMap(db, habitId, createdDate, today);
  let yesterdayStreak = 0;
  if (yesterday >= createdDate) {
    const runsThroughYesterday = computeStreakRuns(habit, entries, createdDate, yesterday);
    const lastRun = runsThroughYesterday[runsThroughYesterday.length - 1];
    yesterdayStreak = lastRun && lastRun.endDate === yesterday ? lastRun.length : 0;
  }
  const todayDone = isScheduled(habit, today) && isCompleted(habit, entries.get(today) ?? null);
  return todayDone ? yesterdayStreak + 1 : yesterdayStreak;
}

// Top `limit` historical streaks, longest first (ties broken by earlier
// start date, for a stable/deterministic order). Empty habit -> [].
export async function getBestStreaks(db: Db, habitId: string, limit: number): Promise<StreakRun[]> {
  const habit = await db.getHabit(habitId);
  const today = await db.getToday();
  const createdDate = isoInstantToLocalDateStr(habit.createdAt);
  if (today < createdDate) return [];
  const entries = await loadEntryMap(db, habitId, createdDate, today);
  const runs = computeStreakRuns(habit, entries, createdDate, today);
  runs.sort((a, b) => (b.length - a.length) || (a.startDate < b.startDate ? -1 : 1));
  return runs.slice(0, limit);
}
