// Layer 2b §5 and §7 — the day-level, whole-list and XP-facing reads.
//
// Everything here is batched. The list view calls two of these on every
// render, and a per-habit query would mean twenty Worker round-trips for
// a screen showing twenty rows.
import type { Db, Entry, Habit } from "../db/types.js";
import {
  toEntryMap, toDayMap, dayKey, computeScoreOrNull, computeCurrentStreak, computeBestStreaks,
  type EntryMap,
} from "./core.js";
import { effectiveStart, resolvePeriodRange, type Period } from "./period.js";
import { isScheduled } from "./schedule.js";
import { isCompleted } from "./completion.js";
import {
  getFrequencyShape, computeQuotaState, periodContaining, describeQuota, type QuotaState,
} from "./frequency.js";
import { minDate } from "./dates.js";

/**
 * "Is this habit due today?" — but only scheduled-shape habits have that
 * answer. A quota habit is handed its quota state instead, because §2.2
 * is explicit that inventing a per-day boolean for it produces numbers
 * that look plausible and are wrong.
 */
export interface DueHabit {
  habit: Habit;
  shape: "scheduled" | "quota";
  /** Only for scheduled-shape habits. */
  due: boolean | null;
  /** Only for quota-shape habits. */
  quota: QuotaState | null;
  entry: Entry | null;
  completed: boolean;
}

/** The window a batched day read needs: the widest period in play. */
function dayWindow(habits: readonly Habit[], date: string): { start: string; end: string } {
  let start = date;
  for (const h of habits) {
    if (getFrequencyShape(h) === "quota") {
      const p = periodContaining(h, date);
      if (p.start < start) start = p.start;
    }
  }
  return { start, end: date };
}

function describeDue(habit: Habit, entries: EntryMap, date: string, today: string): DueHabit {
  const shape = getFrequencyShape(habit);
  const entry = entries.get(dayKey(habit.id, date)) ?? null;
  return {
    habit,
    shape,
    due: shape === "scheduled" ? isScheduled(habit, date) : null,
    quota: shape === "quota" ? computeQuotaState(habit, byDateFor(entries, habit.id), date, today) : null,
    entry,
    completed: isCompleted(habit, entry),
  };
}

/**
 * A per-habit view of the shared map, keyed by date alone.
 *
 * The batched fetch has to key on habit AND date; the compute functions
 * take a date-keyed map. Narrowing here keeps that translation in one
 * place rather than at every call site.
 */
function byDateFor(all: EntryMap, habitId: string): EntryMap {
  const out = new Map<string, Entry>();
  for (const entry of all.values()) {
    if (entry.habitId === habitId) out.set(entry.date, entry);
  }
  return out;
}

/**
 * Every habit's effective start, from one batched read.
 *
 * `effectiveStart` needs the habit's first logged entry, because history
 * backfilled before the habit existed still counts. Fetching that per
 * habit would make every whole-list read O(habits) statements.
 */
async function effectiveStarts(db: Db, habits: readonly Habit[]): Promise<Map<string, string>> {
  const firsts = await db.getFirstEntryDates(habits.map((h) => h.id));
  const out = new Map<string, string>();
  for (const h of habits) out.set(h.id, effectiveStart(h, firsts[h.id] ?? null));
  return out;
}

/** Flat entry list → per-habit, date-keyed maps for the compute functions. */
function groupByHabit(entries: readonly Entry[]): Map<string, EntryMap> {
  const byHabit = new Map<string, Map<string, Entry>>();
  for (const e of entries) {
    let m = byHabit.get(e.habitId);
    if (!m) byHabit.set(e.habitId, (m = new Map()));
    m.set(e.date, e);
  }
  return byHabit;
}

/**
 * Habits due on a date. Quota-shape habits come back with their quota
 * state rather than a due/not-due boolean (§5).
 */
export async function getScheduledHabitsForDate(db: Db, date?: string): Promise<DueHabit[]> {
  const [today, habits] = await Promise.all([db.getToday(), db.listHabits()]);
  const when = date ?? today;
  const entries = toDayMap(await rawDayEntries(db, habits, when));
  return habits
    .map((h) => describeDue(h, entries, when, today))
    .filter((d) => d.shape === "quota" || d.due);
}

/** Every active habit's state for one day. One query, whatever the count. */
export async function getCompletionsForDate(db: Db, date?: string): Promise<DueHabit[]> {
  const [today, habits] = await Promise.all([db.getToday(), db.listHabits()]);
  const when = date ?? today;
  const entries = toDayMap(await rawDayEntries(db, habits, when));
  return habits.map((h) => describeDue(h, entries, when, today));
}

async function rawDayEntries(db: Db, habits: readonly Habit[], date: string): Promise<Entry[]> {
  if (!habits.length) return [];
  const { start, end } = dayWindow(habits, date);
  return db.getEntriesForHabits(habits.map((h) => h.id), start, end);
}

/**
 * Completed ÷ due for one day, across active habits. Null when nothing
 * was due — a rest day is not 0% (§4.2).
 */
export async function getDayCompletionRate(db: Db, date?: string): Promise<number | null> {
  const all = await getCompletionsForDate(db, date);
  // Quota habits have no per-day obligation, so they cannot be part of a
  // per-day rate without inventing one.
  const due = all.filter((d) => d.shape === "scheduled" && d.due);
  if (!due.length) return null;
  return Math.round((100 * due.filter((d) => d.completed).length) / due.length);
}

export interface HabitSummary {
  habit: Habit;
  /** Null when the period predates this habit's history (§4.2). */
  score: number | null;
  currentStreak: number;
  bestStreak: number;
  shape: "scheduled" | "quota";
  /** For quota habits: where they stand this period. */
  quota: QuotaState | null;
  /** "3× per week", or null for scheduled shapes. */
  quotaLabel: string | null;
}

/**
 * Score, current streak and best streak for every active habit, from ONE
 * batched entry read (§5, test 17).
 *
 * The list view renders this; a query per habit would be twenty
 * round-trips across the Worker boundary for twenty rows.
 */
export async function getHabitsSummary(db: Db, period: Period = "month"): Promise<HabitSummary[]> {
  const [today, habits] = await Promise.all([db.getToday(), db.listHabits()]);
  if (!habits.length) return [];

  // Each habit's window starts at the later of its creation and its
  // first entry; the batch has to span the earliest of those. Both reads
  // are one statement each, whatever the habit count (§5, test 17).
  const starts = await effectiveStarts(db, habits);
  const earliest = [...starts.values()].reduce((a, b) => (a < b ? a : b), today);

  const all = await db.getEntriesForHabits(habits.map((h) => h.id), earliest, today);
  const byHabit = groupByHabit(all);

  return habits.map((habit) => {
    const entries: EntryMap = byHabit.get(habit.id) ?? new Map();
    const start = starts.get(habit.id)!;
    const span = resolvePeriodRange(period, today, start);
    const shape = getFrequencyShape(habit);
    const runs = computeBestStreaks(habit, start, entries, today, 1);
    return {
      habit,
      score: computeScoreOrNull(habit, entries, span.start, span.end, today),
      currentStreak: computeCurrentStreak(habit, start, entries, today),
      bestStreak: runs.length ? runs[0].length : 0,
      shape,
      quota: shape === "quota" ? computeQuotaState(habit, entries, today, today) : null,
      quotaLabel: shape === "quota" ? describeQuota(habit) : null,
    };
  });
}

/**
 * Mean score across active habits (§5).
 *
 * Archived habits are excluded, and so are habits whose score is null —
 * from the count as well as the total. Including a habit created
 * yesterday as a 0 would drag the average down with a number that does
 * not exist.
 */
export async function getAggregateScore(db: Db, period: Period = "month"): Promise<number | null> {
  const scored = (await getHabitsSummary(db, period))
    .map((s) => s.score)
    .filter((s): s is number => s !== null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}

// ── §7 XP surface — the habit app's side only ─────────────────────────

export interface CompletionRow {
  habitId: string;
  habitName: string;
  date: string;
  value: number;
  /** Direction-aware: already accounts for at_most (§7.2). */
  completed: boolean;
  frequencyShape: "scheduled" | "quota";
  /** The streak as it stood on that date, not today's (§7.2). */
  streakAtDate: number;
  updatedAt: string;
}

/**
 * The habit's streak as it stood on `date` — not today's.
 *
 * Required for correct XP on a backfilled entry: logging last Tuesday
 * today should be worth what last Tuesday was worth, not what today is.
 */
export async function getStreakAtDate(db: Db, habitId: string, date: string): Promise<number> {
  const [habit, firstEntry] = await Promise.all([db.getHabit(habitId), db.getFirstEntryDate(habitId)]);
  const start = effectiveStart(habit, firstEntry);
  if (date < start) return 0;
  const entries = await db.getEntriesForHabit(habitId, start, date);
  // Passing `date` as "today" is the whole trick: every function below
  // then reasons about the world as it was on that day.
  return computeCurrentStreak(habit, start, toEntryMap(entries), date);
}

/**
 * Completions updated after `since`, for incremental ingestion (§7.2).
 *
 * `completed` and `streakAtDate` are the load-bearing fields: they let
 * Kahiro award flat or streak-weighted XP without reimplementing any
 * habit logic, which is the point of the whole arrangement.
 */
export async function getCompletionsSince(db: Db, since: string | null): Promise<CompletionRow[]> {
  const [today, habits] = await Promise.all([db.getToday(), db.listHabits({ includeArchived: true })]);
  if (!habits.length) return [];

  const starts = await effectiveStarts(db, habits);
  const earliest = [...starts.values()].reduce((a, b) => (a < b ? a : b), today);
  const all = await db.getEntriesForHabits(habits.map((h) => h.id), earliest, today);

  const byHabit = groupByHabit(all);
  const habitById = new Map(habits.map((h) => [h.id, h]));

  const out: CompletionRow[] = [];
  for (const e of all) {
    if (since !== null && e.updatedAt <= since) continue;
    const habit = habitById.get(e.habitId);
    if (!habit) continue;
    const entries: EntryMap = byHabit.get(e.habitId) ?? new Map();
    const start = starts.get(e.habitId)!;
    out.push({
      habitId: habit.id,
      habitName: habit.name,
      date: e.date,
      value: e.value,
      completed: isCompleted(habit, e),
      frequencyShape: getFrequencyShape(habit),
      streakAtDate: computeCurrentStreak(habit, start, entries, minDate(e.date, today)),
      updatedAt: e.updatedAt,
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
}
