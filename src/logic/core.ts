// The whole of Layer 2's arithmetic, as synchronous pure functions over
// an in-memory entry map. No database, no async, no rendering.
//
// Two reasons this layer is shaped this way rather than each function
// awaiting its own queries:
//
//  1. Spec §4 requires Layer 2 be "testable in isolation". These
//     functions need nothing but plain objects, so they are covered by
//     fast unit tests instead of only via a browser.
//  2. A trend line or heatmap is ~30 data points. Querying per point
//     means ~30 sequential round-trips across the Worker boundary every
//     time a card renders. Each `compute*` here is paired with a
//     `spanFor*` telling the caller the single range to fetch, so one
//     query serves the whole chart.
import type { Habit, Entry } from "../db/types.js";
import {
  addDays, dateRange, weekStart, monthOf, firstOfMonth, lastOfMonth,
  shiftMonth, minDate, maxDate, clamp,
} from "./dates.js";
import { isScheduled, countScheduledDays } from "./schedule.js";
import { isCompleted } from "./completion.js";
import { resolvePeriodRange, type Period } from "./period.js";
import {
  getFrequencyShape, computeQuotaScore, computeQuotaStreak, computeQuotaBestRuns,
  computeQuotaState, periodsBetween, periodContaining,
} from "./frequency.js";

/** date → entry, the shape every compute function reads. */
export type EntryMap = ReadonlyMap<string, Entry>;

export interface DateSpan { start: string; end: string }
export interface StreakRun { startDate: string; endDate: string; length: number }
export interface TrendPoint { date: string; score: number }
export interface HistoryBucket { start: string; end: string; count: number; met: boolean }
export interface HeatmapDay { date: string; level: 0 | 1 | 2 | 3 | 4 }

export function toEntryMap(entries: readonly Entry[]): EntryMap {
  return new Map(entries.map((e) => [e.date, e]));
}

/**
 * The key for a map that spans several habits, where the date alone is
 * not unique.
 *
 * One function, used everywhere, because two call sites once disagreed
 * about the separator — a space in one, a NUL in the other — and the
 * lookups silently missed rather than failing. NUL because it cannot
 * appear in a habit id.
 */
export const dayKey = (habitId: string, date: string): string => `${habitId}\u0000${date}`;

/** Entries keyed by habit AND date, for batched multi-habit reads. */
export function toDayMap(entries: readonly Entry[]): EntryMap {
  return new Map(entries.map((e) => [dayKey(e.habitId, e.date), e]));
}

// ── Tuning constants, in one place ────────────────────────────────────
/** Sub-window each trend point averages over, by period. */
const TREND_WINDOW_DAYS: Record<Period, number> = { week: 3, month: 7, year: 30, all: 30 };
const TREND_YEAR_MONTHS = 12;
const HISTORY_WEEK_BUCKETS = 8;
const HISTORY_MONTH_BUCKETS = 6;
const HEATMAP_WINDOW_DAYS = 7;
/** A bucket/day counts as "met" at the same cutoff getScoreColor calls good. */
const MET_THRESHOLD = 70;

// ── Score ─────────────────────────────────────────────────────────────

export function countCompletions(habit: Habit, entries: EntryMap, start: string, end: string): number {
  if (start > end) return 0;
  let n = 0;
  for (const date of dateRange(start, end)) {
    if (isScheduled(habit, date) && isCompleted(habit, entries.get(date))) n++;
  }
  return n;
}

/**
 * score = round(100 × completions ÷ scheduled days), clamped to 0-100.
 *
 * Completions only count on scheduled days, and the denominator comes
 * from the habit's frequency config — never raw calendar days. A window
 * containing no scheduled days at all (e.g. a Mon/Wed/Fri habit over a
 * weekend) scores 0 rather than dividing by zero.
 */
/**
 * The score, or null when the window contains nothing the habit could
 * have been judged on — Layer 2b §4.2.
 *
 * A period before the habit existed, or a Mon/Wed/Fri habit over a bare
 * weekend, has no score. It is unknowable, not zero, and the difference
 * matters: 0% reads as total failure where "—" reads as "not yet". Null
 * is the honest answer and the UI already renders it.
 */
export function computeScoreOrNull(
  habit: Habit, entries: EntryMap, start: string, end: string, today?: string,
): number | null {
  // Layer 2b §4.4. A day that has not happened cannot have been missed,
  // so it must not sit in the denominator. Asking for a whole month on
  // the 14th previously scored ~45% at best, because the remaining
  // seventeen days counted as failures.
  const last = today ? minDate(end, today) : end;
  if (start > last) return null;

  // Layer 2b §2.3 branch point 1 of 5.
  if (getFrequencyShape(habit) === "quota") {
    return computeQuotaScore(habit, entries, start, last, today ?? last);
  }
  const scheduled = countScheduledDays(habit, start, last);
  if (scheduled <= 0) return null;
  const completions = countCompletions(habit, entries, start, last);
  return Math.max(0, Math.min(100, Math.round((100 * completions) / scheduled)));
}

/**
 * The score as a number, treating "no score" as 0.
 *
 * The one place null collapses, kept explicit so it is a decision rather
 * than an accident. Callers that must distinguish the two — the overview
 * card, aggregates — use computeScoreOrNull.
 */
export function computeScore(habit: Habit, entries: EntryMap, start: string, end: string, today?: string): number {
  return computeScoreOrNull(habit, entries, start, end, today) ?? 0;
}

export type ScoreColor = "success-green" | "accent-gold" | "danger-red";

/** THE definition of score colour (spec §4). Everything else calls this. */
export function getScoreColor(score: number): ScoreColor {
  if (score >= 70) return "success-green";
  if (score >= 40) return "accent-gold";
  return "danger-red";
}

/** Spec §2 hex values, kept beside the names so no second table exists. */
export const SCORE_COLOR_HEX: Record<ScoreColor, string> = {
  "success-green": "#7BC862",
  "accent-gold": "#D4A843",
  "danger-red": "#E05252",
};

export function spanForPeriod(start: string, today: string, period: Period): DateSpan {
  return resolvePeriodRange(period, today, start);
}

// ── Streaks ───────────────────────────────────────────────────────────

/**
 * Maximal runs of consecutive *scheduled* days that were all completed.
 * Unscheduled days are skipped without starting, extending, or breaking a
 * run — "a non-scheduled day does not break a streak" (spec §4).
 */
export function computeStreakRuns(habit: Habit, entries: EntryMap, start: string, end: string): StreakRun[] {
  const runs: StreakRun[] = [];
  let openStart: string | null = null;
  let openEnd = "";
  let length = 0;

  for (const date of dateRange(start, end)) {
    if (!isScheduled(habit, date)) continue;
    if (isCompleted(habit, entries.get(date))) {
      openStart ??= date;
      openEnd = date;
      length++;
    } else if (openStart !== null) {
      runs.push({ startDate: openStart, endDate: openEnd, length });
      openStart = null;
      length = 0;
    }
  }
  if (openStart !== null) runs.push({ startDate: openStart, endDate: openEnd, length });
  return runs;
}

export function spanForStreaks(start: string, today: string): DateSpan {
  return { start, end: today };
}

/**
 * The most recent scheduled day strictly before `today`, or null if the
 * habit has none yet. For a daily habit this is simply yesterday; for a
 * Mon/Wed/Fri habit asked on a Friday it is the preceding Wednesday.
 */
function previousScheduledDay(habit: Habit, today: string, created: string): string | null {
  for (let d = addDays(today, -1); d >= created; d = addDays(d, -1)) {
    if (isScheduled(habit, d)) return d;
  }
  return null;
}

/**
 * Consecutive scheduled days completed up to today.
 *
 * A streak is live if it reaches the last day the habit was actually due
 * — not literally yesterday. Anchoring on yesterday would report every
 * Mon/Wed/Fri streak as broken whenever today is a Monday, because the
 * intervening weekend was never a scheduled day to begin with.
 *
 * Today being scheduled but not yet logged does not break the streak
 * either — the day is not over. It just does not add to it until logged.
 */
export function computeCurrentStreak(habit: Habit, start: string, entries: EntryMap, today: string): number {
  if (today < start) return 0;
  // Layer 2b §2.3 branch point 2 of 5. A quota habit's streak counts
  // periods, not days: "4 weeks" on a 3x/week habit means four weeks of
  // hitting three. Days would be meaningless.
  if (getFrequencyShape(habit) === "quota") return computeQuotaStreak(habit, start, entries, today);

  let priorStreak = 0;
  const lastDue = previousScheduledDay(habit, today, start);
  if (lastDue) {
    const runs = computeStreakRuns(habit, entries, start, lastDue);
    const last = runs[runs.length - 1];
    if (last && last.endDate === lastDue) priorStreak = last.length;
  }

  const todayCounts = isScheduled(habit, today) && isCompleted(habit, entries.get(today));
  return todayCounts ? priorStreak + 1 : priorStreak;
}

/** Longest first; ties broken by earlier start so ordering is stable. */
export function computeBestStreaks(habit: Habit, start: string, entries: EntryMap, today: string, limit: number): StreakRun[] {
  if (today < start || limit <= 0) return [];
  // Layer 2b §2.3 branch point 3 of 5. Runs of periods, not of days.
  if (getFrequencyShape(habit) === "quota") {
    return computeQuotaBestRuns(habit, start, entries, today, limit);
  }
  return computeStreakRuns(habit, entries, start, today)
    .sort((a, b) => b.length - a.length || (a.startDate < b.startDate ? -1 : 1))
    .slice(0, limit);
}

// ── Trend ─────────────────────────────────────────────────────────────

/**
 * The dates each trend point lands on. Daily resolution for week/month,
 * monthly for year/all, so the series stays readable at any zoom.
 */
function trendPointDates(start: string, today: string, period: Period): string[] {
  if (today < start) return [];

  if (period === "week" || period === "month") {
    const span = resolvePeriodRange(period, today, start);
    return dateRange(span.start, span.end);
  }

  const firstMonth = period === "year"
    ? maxDate(monthOf(shiftMonth(monthOf(today), -(TREND_YEAR_MONTHS - 1))), monthOf(start))
    : monthOf(start);

  const dates: string[] = [];
  let cursor = firstMonth;
  while (cursor <= monthOf(today)) {
    dates.push(minDate(lastOfMonth(cursor), today));
    cursor = shiftMonth(cursor, 1);
  }
  return dates;
}

export function spanForTrend(start: string, today: string, period: Period): DateSpan {
  const dates = trendPointDates(start, today, period);
  if (!dates.length) return { start, end: today };
  // Each point averages a trailing sub-window, so the earliest data
  // needed sits before the first point.
  return { start: maxDate(addDays(dates[0], -(TREND_WINDOW_DAYS[period] - 1)), start), end: today };
}

/**
 * Each point is a rolling score over a short trailing window rather than
 * that single day's raw value: one boolean day is only ever 0 or 100, so
 * a raw series would be a square wave rather than a trend.
 *
 * Fewer than 2 points is a legitimate result for a young habit — the UI
 * renders "not enough data yet" from it (spec Screen 2C), so this does
 * not invent points to pad the chart.
 */
export function computeTrend(habit: Habit, start: string, entries: EntryMap, today: string, period: Period): TrendPoint[] {
  // Layer 2b §2.3 branch point 4 of 5. A rolling few-day window is
  // meaningless for a quota habit — three days cannot express "3 per
  // week" — so each point is a completed period's own score instead.
  if (getFrequencyShape(habit) === "quota") {
    return periodsBetween(habit, start, today).map((p) => ({
      date: minDate(p.end, today),
      score: computeQuotaScore(habit, entries, p.start, p.end, today) ?? 0,
    }));
  }
  const window = TREND_WINDOW_DAYS[period];
  return trendPointDates(start, today, period).map((date) => ({
    date,
    score: computeScore(habit, entries, maxDate(addDays(date, -(window - 1)), start), date, today),
  }));
}

// ── History ───────────────────────────────────────────────────────────

/** Calendar-aligned buckets, oldest first, clipped to the habit's life. */
function historyBucketRanges(start: string, today: string, period: "week" | "month"): DateSpan[] {
  if (today < start) return [];
  const ranges: DateSpan[] = [];

  if (period === "week") {
    let cursor = weekStart(today);
    for (let i = 0; i < HISTORY_WEEK_BUCKETS; i++) {
      const rawEnd = addDays(cursor, 6);
      if (rawEnd < start) break;
      ranges.unshift({ start: maxDate(cursor, start), end: minDate(rawEnd, today) });
      cursor = addDays(cursor, -7);
    }
  } else {
    let cursor = monthOf(today);
    const startMonth = monthOf(start);
    for (let i = 0; i < HISTORY_MONTH_BUCKETS; i++) {
      const bucketStart = maxDate(firstOfMonth(cursor), start);
      const end = minDate(lastOfMonth(cursor), today);
      if (bucketStart <= end) ranges.unshift({ start: bucketStart, end });
      if (cursor === startMonth) break;
      cursor = shiftMonth(cursor, -1);
    }
  }
  return ranges;
}

export function spanForHistory(start: string, today: string, period: "week" | "month"): DateSpan {
  const ranges = historyBucketRanges(start, today, period);
  if (!ranges.length) return { start, end: today };
  return { start: ranges[0].start, end: today };
}

/** Bar per bucket: how many completions, and whether the bucket hit target. */
export function computeHistory(
  habit: Habit, start: string, entries: EntryMap, today: string, period: "week" | "month",
): HistoryBucket[] {
  // Layer 2b §2.3 branch point 5 of 5. Bars are completions per period
  // against the quota line, not per day (§2.2), and the bucket is the
  // habit's own period rather than the requested one — a month bucket on
  // a 3x/week habit would compare against the wrong number.
  if (getFrequencyShape(habit) === "quota") {
    return periodsBetween(habit, start, today).map((p) => {
      const state = computeQuotaState(habit, entries, p.start, today);
      return {
        start: maxDate(p.start, start),
        end: minDate(p.end, today),
        count: state.completed,
        met: state.met,
      };
    });
  }
  return historyBucketRanges(start, today, period).map(({ start, end }) => ({
    start,
    end,
    count: countCompletions(habit, entries, start, end),
    met: computeScore(habit, entries, start, end) >= MET_THRESHOLD,
  }));
}

// ── Heatmap ───────────────────────────────────────────────────────────

export function spanForHeatmap(start: string, month: string): DateSpan {
  // Early days in the month average a window reaching into the previous
  // one, so the fetch has to start before the 1st.
  return {
    start: maxDate(addDays(firstOfMonth(month), -(HEATMAP_WINDOW_DAYS - 1)), start),
    end: lastOfMonth(month),
  };
}

/**
 * A 0-4 level per day of the month for the 5-step ramp.
 *
 * Like the trend, each day reflects a trailing 7-day rolling score rather
 * than its own binary state — otherwise a boolean habit's calendar would
 * only ever use two of the ramp's five colours. Days outside the habit's
 * life, and days still in the future, are level 0.
 */
export function computeHeatmap(habit: Habit, start: string, entries: EntryMap, today: string, month: string): HeatmapDay[] {
  const quota = getFrequencyShape(habit) === "quota";
  return dateRange(firstOfMonth(month), lastOfMonth(month)).map((date) => {
    if (date > today || date < start) return { date, level: 0 as const };
    // A quota habit's day takes the colour of the period it belongs to:
    // a rolling 7-day window would answer a question the habit does not
    // ask, and every day of a met week should read as met.
    const score = quota
      ? (computeQuotaScore(habit, entries, periodContaining(habit, date).start, date, today) ?? 0)
      : computeScore(habit, entries, clamp(addDays(date, -(HEATMAP_WINDOW_DAYS - 1)), start, date), date, today);
    const level = (score === 0 ? 0 : Math.min(4, Math.ceil(score / 25))) as HeatmapDay["level"];
    return { date, level };
  });
}
