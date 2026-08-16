// The view model behind Screen 1 (the flat habit table).
//
// This lives in Layer 2 rather than in the component because deciding
// what a cell *means* — completed, explicitly missed, awaiting today's
// tap, or a numeric amount — is interpretation, not rendering. Keeping
// it here leaves the UI a pure projection and honours non-negotiable #3:
// the screen never reaches past this layer to the database.
import type { Db, Habit, Routine, Entry } from "../db/types.js";
import { addDays } from "./dates.js";
import { isScheduled } from "./schedule.js";
import { isCompleted } from "./completion.js";

/** What a single day-cell shows. Spec §5, Screen 1. */
export type CellState =
  | { kind: "complete" }
  /** Explicitly recorded as not done — the user tapped to say so. */
  | { kind: "missed" }
  /** Scheduled for today and not yet logged — the tappable gold ring. */
  | { kind: "today" }
  /**
   * A scheduled day that has ended with nothing logged. Distinct from
   * "missed", which the user chose, and from "today", which is still
   * open. Storage is unchanged — there is still no row — but the day is
   * over, and showing it as though it were still fillable is a lie about
   * the calendar.
   */
  | { kind: "lapsed" }
  | { kind: "numeric"; value: number; unit: string | null }
  /** A day this habit was never due. */
  | { kind: "blank" };

export interface ListCell {
  date: string;
  state: CellState;
  /** False on days this habit is not due — the UI dims rather than hides. */
  scheduled: boolean;
}

export interface ListRow {
  habit: Habit;
  /** Aligned index-for-index with ListView.days. */
  cells: ListCell[];
}

export interface ListOptions {
  /** Include archived habits, shown dimmed rather than hidden. */
  includeArchived?: boolean;
  /** Drop habits already completed today — a "what's left" view. */
  hideCompletedToday?: boolean;
}

export interface ListGroup {
  /** null is the trailing group of habits belonging to no routine. */
  routine: Routine | null;
  rows: ListRow[];
}

export interface ListView {
  today: string;
  /** Most recent first, matching Loop's column order. */
  days: string[];
  groups: ListGroup[];
}

export const DEFAULT_LIST_DAYS = 5;

/**
 * Key for the habit-and-date lookup. A NUL separator is used because it
 * cannot occur in a UUID or a YYYY-MM-DD date, so no pair of values can
 * collide. It is a single function rather than an inline template
 * because it was three, and one of them used a space instead — which
 * silently matched nothing and made a filter appear to do nothing at all.
 */
const dayKey = (habitId: string, date: string): string => `${habitId}\u0000${date}`;

/** Most recent first: [today, today-1, …]. */
export function listDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, -i));
}

function cellState(habit: Habit, entry: Entry | undefined, date: string, today: string, scheduled: boolean): CellState {
  if (entry) {
    if (habit.type === "numeric") return { kind: "numeric", value: entry.value, unit: habit.unit };
    return isCompleted(habit, entry) ? { kind: "complete" } : { kind: "missed" };
  }
  // An unlogged day only invites a tap if the habit is actually due
  // today. Offering the ring on a day off would prompt the user to log
  // something the schedule never asked for.
  if (!scheduled) return { kind: "blank" };
  if (date === today) return { kind: "today" };
  // Future days can appear in a range a caller asks for; they have not
  // lapsed, they simply have not happened.
  return date < today ? { kind: "lapsed" } : { kind: "blank" };
}

/**
 * Pure assembly of the list view. Routines come first in their own
 * order, each followed by its habits; habits with no routine form a
 * final unnamed group. A routine with no habits is dropped — an empty
 * group header would be noise.
 */
export function buildListView(
  routines: readonly Routine[],
  habits: readonly Habit[],
  entries: readonly Entry[],
  today: string,
  days: string[],
  opts: ListOptions = {},
): ListView {
  const byHabitDate = new Map<string, Entry>();
  for (const e of entries) byHabitDate.set(dayKey(e.habitId, e.date), e);

  const toRow = (habit: Habit): ListRow => ({
    habit,
    cells: days.map((date) => {
      const scheduled = isScheduled(habit, date);
      return {
        date,
        scheduled,
        state: cellState(habit, byHabitDate.get(dayKey(habit.id, date)), date, today, scheduled),
      };
    }),
  });

  // Filtering happens here rather than in SQL because "completed today"
  // is Layer 2's judgement — it depends on the habit's target and
  // direction, which the database does not evaluate.
  const visible = opts.hideCompletedToday
    ? habits.filter((h) => {
      const entry = byHabitDate.get(dayKey(h.id, today));
      return !(entry && isCompleted(h, entry));
    })
    : habits;

  const groups: ListGroup[] = [];
  for (const routine of routines) {
    const rows = visible.filter((h) => h.routineId === routine.id).map(toRow);
    if (rows.length) groups.push({ routine, rows });
  }
  const loose = visible.filter((h) => h.routineId === null).map(toRow);
  if (loose.length) groups.push({ routine: null, rows: loose });
  return { today, days, groups };
}

/**
 * Reads everything Screen 1 needs. Entries for every habit across the
 * whole window come from a single batched query — the list must never
 * fan out into one query per habit (spec Layer 1 §5).
 */
export async function getListView(
  db: Db,
  dayCount: number = DEFAULT_LIST_DAYS,
  opts: ListOptions = {},
): Promise<ListView> {
  const [today, routines, habits] = await Promise.all([
    db.getToday(),
    db.listRoutines({ includeArchived: opts.includeArchived }),
    db.listHabits({ includeArchived: opts.includeArchived }),
  ]);
  const days = listDays(today, dayCount);
  const oldest = days[days.length - 1];
  const entries = habits.length ? await db.getEntriesForHabits(habits.map((h) => h.id), oldest, today) : [];
  return buildListView(routines, habits, entries, today, days, opts);
}
