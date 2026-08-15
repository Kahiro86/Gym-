// Layer 1's domain shapes and public API surface. Layers 2 and 3 depend
// only on what is declared here — never on SQL, the Worker, or sqlite3.

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
  /** 0-6 (Sun-Sat), only when frequencyType is "specific_days". */
  frequencyDays: number[] | null;
  /** N, only when frequencyType is "times_per_week"/"times_per_month". */
  frequencyCount: number | null;
  routineId: string | null;
  sortOrder: number;
  color: string | null;
  /** "HH:MM", 24h local. */
  reminderTime: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  habitId: string;
  /** YYYY-MM-DD local calendar date — never a timestamp. */
  date: string;
  /** 1/0 for boolean habits; the logged amount for numeric habits. */
  value: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Facts about where the bytes actually went. Reported by the running
 * database, never asserted from source — "we open on X" is a claim, and
 * only the live VFS can settle it.
 */
export interface VfsInfo {
  /** The SQLite VFS the database is registered under. */
  vfsName: string;
  /** Files the VFS currently holds — the database, its journal, temps. */
  files: string[];
}

export interface StorageInfo extends VfsInfo {
  /** Whether the browser has granted eviction-resistant storage. */
  persisted: boolean;
  /** False when persistence was already granted and nothing was asked. */
  persistRequested: boolean;
}

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
export type UpdateHabitPatch = Partial<CreateHabitInput>;

/**
 * The complete Layer 1 surface. Nothing above this layer may bypass it —
 * if Layer 2 needs data not exposed here, a method gets added here rather
 * than a query being written upstairs (spec Layer 1 §1, boundary rule).
 */
export interface Db {
  createRoutine(data: CreateRoutineInput): Promise<Routine>;
  getRoutine(id: string): Promise<Routine>;
  listRoutines(opts?: { includeArchived?: boolean }): Promise<Routine[]>;
  updateRoutine(id: string, patch: UpdateRoutinePatch): Promise<Routine>;
  archiveRoutine(id: string): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  reorderRoutines(orderedIds: string[]): Promise<void>;

  createHabit(data: CreateHabitInput): Promise<Habit>;
  getHabit(id: string): Promise<Habit>;
  listHabits(opts?: { includeArchived?: boolean; routineId?: string | null }): Promise<Habit[]>;
  updateHabit(id: string, patch: UpdateHabitPatch): Promise<Habit>;
  archiveHabit(id: string): Promise<void>;
  unarchiveHabit(id: string): Promise<void>;
  deleteHabit(id: string, opts?: { confirmed?: boolean }): Promise<void>;
  reorderHabits(orderedIds: string[]): Promise<void>;

  getEntry(habitId: string, date: string): Promise<Entry | null>;
  getEntriesForHabit(habitId: string, startDate: string, endDate: string): Promise<Entry[]>;
  getEntriesForDate(date: string): Promise<Entry[]>;
  getEntriesForHabits(habitIds: string[], startDate: string, endDate: string): Promise<Entry[]>;
  setEntry(habitId: string, date: string, value: number, note?: string | null): Promise<Entry>;
  deleteEntry(habitId: string, date: string): Promise<void>;
  getFirstEntryDate(habitId: string): Promise<string | null>;
  getEntryCount(habitId: string): Promise<number>;

  getToday(): Promise<string>;
  getDayStartHour(): Promise<number>;
  setDayStartHour(hour: number): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  /** Where the data is stored and whether it is safe from eviction. */
  getStorageInfo(): Promise<StorageInfo>;

  // ── Test-only seams. Never called by application code. ──────────────
  /** Pins the Worker's clock; null restores the real one. */
  __setTestClock(ms: number | null): Promise<void>;
  /** Statements executed through the repository since the last reset. */
  __getStatementCount(): Promise<number>;
  __resetStatementCount(): Promise<void>;
  /** Full entries table, for before/after comparisons. */
  __dumpEntries(): Promise<Entry[]>;
  /**
   * Plain INSERT with no ON CONFLICT clause — the only way to genuinely
   * attempt a duplicate (habit_id, date) row and observe the schema-level
   * UNIQUE constraint reject it. setEntry() upserts by design and so can
   * never produce the violation the spec requires be *proven*.
   */
  __rawInsertEntry(habitId: string, date: string, value: number): Promise<void>;
}
