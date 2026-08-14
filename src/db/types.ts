// Domain types for Layer 1. These are the shapes stored/returned by the
// data access module — Layer 2 and 3 depend only on these, never on SQL.

export type HabitType = "boolean" | "numeric";
export type TargetDirection = "at_least" | "at_most";
export type FrequencyType = "daily" | "specific_days" | "times_per_week" | "times_per_month";

export interface Routine {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  name: string;
  icon: string | null;
  question: string | null;
  type: HabitType;
  unit: string | null;
  target: number | null;
  targetDirection: TargetDirection;
  frequencyType: FrequencyType;
  frequencyDays: number[] | null; // 0-6, Sun-Sat, when specific_days
  frequencyCount: number | null; // N, when times_per_week / times_per_month
  routineId: string | null;
  sortOrder: number;
  color: string | null;
  reminderTime: string | null; // "HH:MM"
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  habitId: string;
  date: string; // YYYY-MM-DD, local calendar date
  value: number; // 1/0 for boolean; logged amount for numeric
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Inputs ──────────────────────────────────────────────────────────
export interface CreateRoutineInput {
  name: string;
  icon?: string | null;
  sortOrder?: number;
}
export type UpdateRoutinePatch = Partial<Pick<Routine, "name" | "icon" | "sortOrder">>;

export interface CreateHabitInput {
  name: string;
  icon?: string | null;
  question?: string | null;
  type: HabitType;
  unit?: string | null;
  target?: number | null;
  targetDirection?: TargetDirection;
  frequencyType: FrequencyType;
  frequencyDays?: number[] | null;
  frequencyCount?: number | null;
  routineId?: string | null;
  sortOrder?: number;
  color?: string | null;
  reminderTime?: string | null;
}
export type UpdateHabitPatch = Partial<Omit<CreateHabitInput, "type">> & { type?: HabitType };

// ── The public data access API — the ONLY surface Layer 2/3 may call ──
export interface Db {
  // Routines
  createRoutine(data: CreateRoutineInput): Promise<Routine>;
  getRoutine(id: string): Promise<Routine>;
  listRoutines(opts?: { includeArchived?: boolean }): Promise<Routine[]>;
  updateRoutine(id: string, patch: UpdateRoutinePatch): Promise<Routine>;
  archiveRoutine(id: string): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  reorderRoutines(orderedIds: string[]): Promise<void>;

  // Habits
  createHabit(data: CreateHabitInput): Promise<Habit>;
  getHabit(id: string): Promise<Habit>;
  listHabits(opts?: { includeArchived?: boolean; routineId?: string | null }): Promise<Habit[]>;
  updateHabit(id: string, patch: UpdateHabitPatch): Promise<Habit>;
  archiveHabit(id: string): Promise<void>;
  unarchiveHabit(id: string): Promise<void>;
  deleteHabit(id: string, opts?: { confirmed?: boolean }): Promise<void>;
  reorderHabits(orderedIds: string[]): Promise<void>;

  // Entries
  getEntry(habitId: string, date: string): Promise<Entry | null>;
  getEntriesForHabit(habitId: string, startDate: string, endDate: string): Promise<Entry[]>;
  getEntriesForDate(date: string): Promise<Entry[]>;
  getEntriesForHabits(habitIds: string[], startDate: string, endDate: string): Promise<Entry[]>;
  setEntry(habitId: string, date: string, value: number, note?: string | null): Promise<Entry>;
  deleteEntry(habitId: string, date: string): Promise<void>;
  getFirstEntryDate(habitId: string): Promise<string | null>;
  getEntryCount(habitId: string): Promise<number>;

  // Utility & settings
  getToday(): Promise<string>;
  getDayStartHour(): Promise<number>;
  setDayStartHour(hour: number): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // Test-only seam (never used by production UI) — see clock.ts.
  __setTestClock(ms: number | null): Promise<void>;
  // Test-only introspection — used by acceptance tests to prove batch
  // queries run as one statement rather than N.
  __getQueryCount(): Promise<number>;
  __resetQueryCount(): Promise<void>;
  // Test-only raw dump — used to prove setDayStartHour never rewrites rows.
  __dumpEntries(): Promise<Entry[]>;
}
