// Layer 2's public surface — the only thing Layer 3 imports.
//
// Each function does exactly two things: fetch the one range core.ts says
// it needs, then hand it to a pure function. No arithmetic lives here,
// and no SQL — reads go through Layer 1's `Db` interface.
import type { Db, Entry, Habit } from "../db/types.js";
import {
  toEntryMap, computeScore, computeCurrentStreak, computeBestStreaks,
  computeTrend, computeHistory, computeHeatmap,
  spanForPeriod, spanForStreaks, spanForTrend, spanForHistory, spanForHeatmap,
  type DateSpan, type EntryMap,
} from "./core.js";
import type { Period } from "./period.js";

export { getScoreColor, SCORE_COLOR_HEX } from "./core.js";
export type {
  StreakRun, TrendPoint, HistoryBucket, HeatmapDay, ScoreColor, EntryMap, DateSpan,
} from "./core.js";
export type { Period } from "./period.js";
export { getListView, listDays, buildListView, DEFAULT_LIST_DAYS } from "./listView.js";
export type { ListView, ListGroup, ListRow, ListCell, CellState } from "./listView.js";

interface Loaded {
  habit: Habit;
  today: string;
  span: DateSpan;
  entries: EntryMap;
}

/**
 * Resolves the habit and "today", asks core.ts for the single span this
 * view needs, and fetches it in one query. Every public function below is
 * this call plus one pure computation.
 */
async function load(db: Db, habitId: string, span: (habit: Habit, today: string) => DateSpan): Promise<Loaded> {
  const [habit, today] = await Promise.all([db.getHabit(habitId), db.getToday()]);
  const resolved = span(habit, today);
  const entries = await db.getEntriesForHabit(habitId, resolved.start, resolved.end);
  return { habit, today, span: resolved, entries: toEntryMap(entries) };
}

/** The base read everything above this layer uses for raw entries. */
export function getEntriesForRange(db: Db, habitId: string, startDate: string, endDate: string): Promise<Entry[]> {
  return db.getEntriesForHabit(habitId, startDate, endDate);
}

export async function getScore(db: Db, habitId: string, period: Period): Promise<number> {
  const { habit, span, entries } = await load(db, habitId, (h, t) => spanForPeriod(h, t, period));
  return computeScore(habit, entries, span.start, span.end);
}

export async function getCurrentStreak(db: Db, habitId: string): Promise<number> {
  const { habit, today, entries } = await load(db, habitId, spanForStreaks);
  return computeCurrentStreak(habit, entries, today);
}

export async function getBestStreaks(db: Db, habitId: string, limit: number) {
  const { habit, today, entries } = await load(db, habitId, spanForStreaks);
  return computeBestStreaks(habit, entries, today, limit);
}

export async function getScoreTrend(db: Db, habitId: string, period: Period) {
  const { habit, today, entries } = await load(db, habitId, (h, t) => spanForTrend(h, t, period));
  return computeTrend(habit, entries, today, period);
}

export async function getHistory(db: Db, habitId: string, period: "week" | "month") {
  const { habit, today, entries } = await load(db, habitId, (h, t) => spanForHistory(h, t, period));
  return computeHistory(habit, entries, today, period);
}

export async function getHeatmapData(db: Db, habitId: string, month: string) {
  const { habit, today, entries } = await load(db, habitId, (h) => spanForHeatmap(h, month));
  return computeHeatmap(habit, entries, today, month);
}

/** Numeric entry. Layer 1 validates the value itself. */
export function setEntry(db: Db, habitId: string, date: string, value: number, note?: string | null): Promise<Entry> {
  return db.setEntry(habitId, date, value, note);
}

/**
 * Tri-state cycle for boolean habits: unlogged → complete → missed →
 * unlogged. "Missed" is a real recorded state, distinct from a day nobody
 * touched, which is why the third step deletes the row rather than
 * writing 0 again.
 */
export async function toggleEntry(db: Db, habitId: string, date: string): Promise<Entry | null> {
  const current = await db.getEntry(habitId, date);
  if (current === null) return db.setEntry(habitId, date, 1);
  if (current.value === 1) return db.setEntry(habitId, date, 0);
  await db.deleteEntry(habitId, date);
  return null;
}
