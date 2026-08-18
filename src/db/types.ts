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

export interface ExportRows {
  routines: Record<string, unknown>[];
  habits: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  meta: { key: string; value: string }[];
}

export interface ImportResult {
  routines: number;
  habits: number;
  entries: number;
  /** Rows a merge left alone because the local copy was newer. */
  skipped: number;
  cleared: boolean;
}

export interface RowCounts {
  habits: number;
  routines: number;
  entries: number;
}

/** What this browser last held, when the database now holds nothing. */
export interface EvictionReport {
  lastKnownHabits: number;
  lastKnownEntries: number;
  lastSeenAt: string;
}

export interface StorageInfo extends VfsInfo {
  /** Whether the browser has granted eviction-resistant storage. */
  persisted: boolean;
  /** False when persistence was already granted and nothing was asked. */
  persistRequested: boolean;
  /** Rows actually present, so an empty database is a fact, not a guess. */
  counts: RowCounts;
  /**
   * Non-null when the database is empty but this browser is known to
   * have held data. Never presented as "no habits yet".
   */
  evicted: EvictionReport | null;
}

/**
 * Layer 1b §8. `pending` means there is local work not yet on the server;
 * `offline` means there is no connection to send it over; `error` means a
 * push was refused and a human needs to know.
 */
export type SyncState = "synced" | "pending" | "offline" | "error";

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
  /** The same, for many habits in one statement. Habits with no entries are omitted. */
  getFirstEntryDates(habitIds: string[]): Promise<Record<string, string>>;
  getEntryCount(habitId: string): Promise<number>;

  getToday(): Promise<string>;
  getDayStartHour(): Promise<number>;
  setDayStartHour(hour: number): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  /** Where the data is stored and whether it is safe from eviction. */
  getStorageInfo(): Promise<StorageInfo>;

  // ── Backup (Layer 2b §5) ────────────────────────────────────────────
  /** Every live row, tombstones and local bookkeeping excluded. */
  exportRows(): Promise<ExportRows>;
  /** Writes an exported dataset back, atomically. Validate before calling. */
  importData(rows: ExportRows, opts: { mode: "replace" | "merge"; confirmed?: boolean }): Promise<ImportResult>;
  /** The clock's current instant, so Layer 2 never calls new Date(). */
  getExportTimestamp(): Promise<string>;

  /**
   * Per-habit write counters, bumped inside each write's own transaction.
   * Layer 2b §6 folds these into its cache keys; Layer 1 neither knows
   * nor cares that a cache exists.
   */
  getWriteCounters(): Promise<Record<string, number>>;

  // ── Sync, as far as anything above Layer 1 is allowed to see it ─────
  // Layer 1b §8: exactly two facts, and no more. The queue, tombstones,
  // sync_status and conflict resolution stay inside.
  getSyncState(): Promise<SyncState>;
  getPendingCount(): Promise<number>;

  // ── Test-only seams. Never called by application code. ──────────────
  /** Pins the Worker's clock; null restores the real one. */
  __setTestClock(ms: number | null): Promise<void>;
  /** Statements executed through the repository since the last reset. */
  __getStatementCount(): Promise<number>;
  __resetStatementCount(): Promise<void>;
  /**
   * Runs several writes atomically (spec §5). Operations are named rather
   * than passed as a callback, because a callback cannot cross the Worker
   * boundary and a live transaction must not be held open across one.
   */
  runTransaction(ops: Array<{ method: string; args: unknown[] }>): Promise<unknown[]>;

  /** Full entries table, for before/after comparisons. */
  __dumpEntries(): Promise<Entry[]>;
  /** Row counts, used to tell an empty database from an evicted one. */
  __rowCounts(): Promise<RowCounts>;
  /** EXPLAIN QUERY PLAN output, to prove a query uses its index. */
  __explain(sql: string, bind?: unknown[]): Promise<string[]>;
  /**
   * Plain INSERT with no ON CONFLICT clause — the only way to genuinely
   * attempt a duplicate (habit_id, date) row and observe the schema-level
   * UNIQUE constraint reject it. setEntry() upserts by design and so can
   * never produce the violation the spec requires be *proven*.
   */
  __rawInsertEntry(habitId: string, date: string, value: number): Promise<void>;
  /** Raw rows INCLUDING tombstones, so a test can prove one exists. */
  __dumpRaw(table: "habits" | "routines" | "entries"): Promise<Record<string, unknown>[]>;
  /** The sync queue in insertion order. */
  __dumpSyncQueue(): Promise<SyncQueueRow[]>;
  /** Runs one push/pull cycle and reports what happened. */
  __syncNow(): Promise<SyncRunResult>;
}

export interface SyncQueueRow {
  id: number;
  tableName: "habits" | "routines" | "entries";
  recordId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface SyncRunResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  /** Why the run stopped early, if it did. */
  error: string | null;
}
