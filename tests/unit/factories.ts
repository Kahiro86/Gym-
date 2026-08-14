// Test factories for Layer 2's pure core. These build plain objects — no
// database is involved, which is the whole point of keeping the
// arithmetic separate from the fetching.
import type { Habit, Entry, HabitType, FrequencyType, TargetDirection } from "../../src/db/types.js";
import { toEntryMap, type EntryMap } from "../../src/logic/core.js";
import { habitCreatedDate } from "../../src/logic/period.js";
import { dateRange } from "../../src/logic/dates.js";

/**
 * createdAt is built from LOCAL date components at midday, so
 * instantToDateStr() round-trips to exactly `createdDate` in any
 * timezone the test runner happens to use.
 */
export function makeHabit(overrides: Partial<Habit> & { createdDate?: string } = {}): Habit {
  const { createdDate = "2026-01-01", ...rest } = overrides;
  const [y, m, d] = createdDate.split("-").map(Number);
  const createdAt = new Date(y, m - 1, d, 12, 0, 0).toISOString();
  return {
    id: "habit-1",
    name: "Test habit",
    icon: null,
    question: null,
    type: "boolean" as HabitType,
    unit: null,
    target: null,
    targetDirection: "at_least" as TargetDirection,
    frequencyType: "daily" as FrequencyType,
    frequencyDays: null,
    frequencyCount: null,
    routineId: null,
    sortOrder: 0,
    color: null,
    reminderTime: null,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
}

export function makeEntry(date: string, value: number, habitId = "habit-1"): Entry {
  return {
    id: `entry-${habitId}-${date}`,
    habitId,
    date,
    value,
    note: null,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

/** Builds an entry map from `{ "2026-01-01": 1, ... }`. */
export function entriesFrom(values: Record<string, number>): EntryMap {
  return toEntryMap(Object.entries(values).map(([date, v]) => makeEntry(date, v)));
}

/** Every day in [start, end] set to `value`. */
export function entriesForRange(start: string, end: string, value = 1): EntryMap {
  return toEntryMap(dateRange(start, end).map((d) => makeEntry(d, value)));
}

/** The habit's creation date — the default scoring start when there is
    no older backfilled entry. */
export function startOf(habit: Habit): string {
  return habitCreatedDate(habit);
}
