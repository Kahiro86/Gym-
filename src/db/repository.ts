// Every SQL statement in the application lives in this file. It runs
// inside the Web Worker against a live sqlite3 OO1 handle; worker.ts only
// dispatches RPC calls to these methods, and client.ts only talks to
// worker.ts over postMessage. Nothing upstairs writes SQL.
import { runMigrations } from "./migrations.js";
import { now } from "./clock.js";
import {
  ValidationError, NotFoundError, ConstraintError,
  ConfirmationRequiredError, IllegalStateChangeError, QuotaExceededError,
} from "./errors.js";
import { assertDateString } from "./dates.js";
import type {
  Routine, Habit, Entry, CreateRoutineInput, UpdateRoutinePatch,
  CreateHabitInput, UpdateHabitPatch, FrequencyType,
} from "./types.js";

/** The slice of sqlite3's OO1 Database this module uses. */
export interface SqlDb {
  exec(sqlOrOpts: string | { sql: string; bind?: unknown }): unknown;
  selectObjects(sql: string, bind?: unknown): Record<string, unknown>[];
  selectValue(sql: string, bind?: unknown): unknown;
  transaction<T>(cb: (db: SqlDb) => T): T;
}

// Counts statements issued through the helpers below. Used by an
// acceptance test to prove batch reads are one statement, not N.
let statementCount = 0;
export const __getStatementCount = (): number => statementCount;
export const __resetStatementCount = (): void => { statementCount = 0; };

function helpers(db: SqlDb) {
  // sqlite3 rejects a bind argument on a statement that has no
  // placeholders ("This statement has no bindable parameters"), so an
  // empty list must be passed as undefined rather than [].
  const b = (bind: unknown[]): unknown[] | undefined => (bind.length ? bind : undefined);
  return {
    run(sql: string, bind: unknown[] = []): void {
      statementCount++;
      db.exec({ sql, bind: b(bind) });
    },
    rows(sql: string, bind: unknown[] = []): Record<string, unknown>[] {
      statementCount++;
      return db.selectObjects(sql, b(bind));
    },
    one(sql: string, bind: unknown[] = []): unknown {
      statementCount++;
      return db.selectValue(sql, b(bind));
    },
  };
}

const uuid = (): string => crypto.randomUUID();
const stamp = (): string => now().toISOString();
const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Formats a Date as a LOCAL calendar date. Never toISOString(), which
 * converts to UTC and shifts the day for anyone east or west of it at
 * certain hours (spec §3).
 */
const localDateStr = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * Spec §9.9 tests 44 and 45. A stored NaN poisons every average computed
 * from it, forever, with no way to tell afterwards which day was wrong;
 * Infinity does the same to every sum. Negative amounts have no meaning
 * in this model — a day not done is `0`, an unlogged day is no row —
 * so a negative is a mistake, not a value.
 */
function assertEntryValue(value: unknown): number {
  if (typeof value !== "number") {
    throw new ValidationError("value", value, "must be a number");
  }
  if (Number.isNaN(value)) {
    throw new ValidationError("value", value, "must be a number, and NaN is not one");
  }
  if (!Number.isFinite(value)) {
    throw new ValidationError("value", value, "must be finite — Infinity cannot be summed or averaged");
  }
  if (value < 0) {
    throw new ValidationError(
      "value", value,
      "must not be negative — a day not done is 0, and an unlogged day has no row at all",
    );
  }
  return value;
}

/** Spec §9.9 test 41. Rejects both "" and whitespace-only. */
function assertName(field: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(field, value, "is required and cannot be blank");
  }
  return value;
}

// ── Sync bookkeeping (Layer 1b §4) ────────────────────────────────────
export type SyncTable = "habits" | "routines" | "entries";
type SyncOperation = "upsert" | "delete";

/**
 * The row as the server should see it. `sync_status` is local-only
 * bookkeeping (§4.1) and is stripped here rather than at push time, so
 * there is exactly one place it can leak from and it is this one.
 */
function pushPayload(row: Record<string, unknown>): Record<string, unknown> {
  const { sync_status: _ignored, ...rest } = row;
  return rest;
}

/**
 * The columns that travel to and from the server, per table. Listed
 * explicitly rather than derived from the schema so that adding a column
 * is a decision about whether it syncs, not an accident. `sync_status` is
 * absent from every list on purpose — it is local bookkeeping (§4.1).
 */
const SYNCED_COLUMNS: Record<SyncTable, string[]> = {
  routines: [
    "id", "name", "icon", "sort_order", "archived_at", "created_at", "updated_at",
    "user_id", "deleted_at",
  ],
  habits: [
    "id", "name", "icon", "question", "type", "unit", "target", "target_direction",
    "frequency_type", "frequency_days", "frequency_count", "routine_id", "sort_order",
    "color", "reminder_time", "archived_at", "created_at", "updated_at",
    "user_id", "deleted_at",
  ],
  entries: [
    "id", "habit_id", "date", "value", "note", "created_at", "updated_at",
    "user_id", "deleted_at",
  ],
};

export interface SyncQueueItem {
  id: number;
  tableName: SyncTable;
  recordId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

// ── Row → domain ──────────────────────────────────────────────────────
const toRoutine = (r: Record<string, unknown>): Routine => ({
  id: String(r.id),
  name: String(r.name),
  icon: (r.icon as string) ?? null,
  sortOrder: Number(r.sort_order),
  archivedAt: (r.archived_at as string) ?? null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toHabit = (r: Record<string, unknown>): Habit => ({
  id: String(r.id),
  name: String(r.name),
  icon: (r.icon as string) ?? null,
  question: (r.question as string) ?? null,
  type: r.type as Habit["type"],
  unit: (r.unit as string) ?? null,
  target: r.target == null ? null : Number(r.target),
  targetDirection: r.target_direction as Habit["targetDirection"],
  frequencyType: r.frequency_type as FrequencyType,
  frequencyDays: r.frequency_days == null ? null : (JSON.parse(String(r.frequency_days)) as number[]),
  frequencyCount: r.frequency_count == null ? null : Number(r.frequency_count),
  routineId: (r.routine_id as string) ?? null,
  sortOrder: Number(r.sort_order),
  color: (r.color as string) ?? null,
  reminderTime: (r.reminder_time as string) ?? null,
  archivedAt: (r.archived_at as string) ?? null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toEntry = (r: Record<string, unknown>): Entry => ({
  id: String(r.id),
  habitId: String(r.habit_id),
  date: String(r.date),
  value: Number(r.value),
  note: (r.note as string) ?? null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

// ── Validation (spec §4.2), enforced here, not only in the UI ─────────
const FREQUENCY_TYPES: FrequencyType[] = ["daily", "specific_days", "times_per_week", "times_per_month"];

interface HabitShape {
  type: string;
  unit: string | null;
  target: number | null;
  targetDirection: string;
  frequencyType: string;
  frequencyDays: number[] | null;
  frequencyCount: number | null;
}

function validateHabitShape(h: HabitShape): void {
  if (h.type !== "boolean" && h.type !== "numeric") {
    throw new ValidationError("type", h.type, "must be 'boolean' or 'numeric'");
  }
  if (h.targetDirection !== "at_least" && h.targetDirection !== "at_most") {
    throw new ValidationError("targetDirection", h.targetDirection, "must be 'at_least' or 'at_most'");
  }
  if (h.type === "numeric") {
    if (h.target == null) throw new ValidationError("target", h.target, "numeric habits require a target");
    if (typeof h.target !== "number" || Number.isNaN(h.target)) {
      throw new ValidationError("target", h.target, "must be a number");
    }
  } else {
    if (h.target != null) throw new ValidationError("target", h.target, "boolean habits must not have a target");
    if (h.unit != null) throw new ValidationError("unit", h.unit, "boolean habits must not have a unit");
  }
  if (!FREQUENCY_TYPES.includes(h.frequencyType as FrequencyType)) {
    throw new ValidationError("frequencyType", h.frequencyType, `must be one of ${FREQUENCY_TYPES.join(", ")}`);
  }
  if (h.frequencyType === "specific_days") {
    const d = h.frequencyDays;
    const ok = Array.isArray(d) && d.length >= 1
      && d.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)
      && new Set(d).size === d.length;
    if (!ok) {
      throw new ValidationError("frequencyDays", d, "specific_days requires a non-empty array of unique integers 0-6");
    }
  } else if (h.frequencyDays != null) {
    throw new ValidationError("frequencyDays", h.frequencyDays, "must be null unless frequencyType is 'specific_days'");
  }
  if (h.frequencyType === "times_per_week" || h.frequencyType === "times_per_month") {
    if (!Number.isInteger(h.frequencyCount) || (h.frequencyCount as number) < 1) {
      throw new ValidationError("frequencyCount", h.frequencyCount, `${h.frequencyType} requires an integer >= 1`);
    }
  } else if (h.frequencyCount != null) {
    throw new ValidationError("frequencyCount", h.frequencyCount, "must be null unless frequencyType is times_per_week/times_per_month");
  }
}

export class Repository {
  private readonly db: SqlDb;
  private readonly h: ReturnType<typeof helpers>;

  constructor(db: SqlDb) {
    this.db = db;
    this.h = helpers(db);
    runMigrations(db as unknown as Parameters<typeof runMigrations>[0]);
  }

  /**
   * How many transactions deep this call is.
   *
   * Every mutation wraps itself in a transaction so it is atomic with its
   * sync-queue row. `runTransaction` then wraps several of those, and
   * SQLite has no nested BEGIN — it fails outright with "cannot start a
   * transaction within a transaction". Joining the outer transaction
   * instead is not a workaround but the correct semantics: the caller
   * asked for all-or-nothing across the whole batch, so an inner commit
   * would be exactly wrong.
   */
  private txDepth = 0;

  /** Runs `cb` inside a transaction, or inside the current one if any. */
  private inTransaction<T>(cb: () => T): T {
    if (this.txDepth > 0) return cb();
    this.txDepth++;
    try {
      return this.db.transaction(() => cb());
    } finally {
      this.txDepth--;
    }
  }

  // ── Sync bookkeeping ────────────────────────────────────────────────
  /**
   * Runs a mutation and records it for the sync engine in ONE transaction.
   *
   * This is the concrete reason Layer 1b keeps SQLite rather than moving
   * the queue to a separate store: either the change and its queue row
   * both land or neither does. A tab killed mid-write cannot leave data
   * the server will never hear about, or a queue entry describing a write
   * that did not happen.
   *
   * `sqlite3`'s `transaction()` hands back the same connection, so the
   * existing `this.h` helpers are already inside the transaction.
   */
  private write<T>(cb: (enqueue: (table: SyncTable, recordId: string, op: SyncOperation) => void) => T): T {
    return this.inTransaction(() => cb((table, recordId, op) => this.enqueue(table, recordId, op)));
  }

  private enqueue(table: SyncTable, recordId: string, operation: SyncOperation): void {
    // The row as of write time, including a tombstone if that is what
    // just happened — a delete is pushed as data, not as an absence.
    const rows = this.h.rows(`SELECT * FROM ${table} WHERE id=?`, [recordId]);
    const payload = rows.length ? pushPayload(rows[0]) : { id: recordId };
    this.h.run(
      `INSERT INTO sync_queue(table_name,record_id,operation,payload,attempts,last_error,created_at)
       VALUES (?,?,?,?,0,NULL,?)`,
      [table, recordId, operation, JSON.stringify(payload), stamp()],
    );
  }

  // ── Routines ────────────────────────────────────────────────────────
  createRoutine(data: CreateRoutineInput): Routine {
    assertName("name", data?.name);
    const id = uuid();
    const ts = stamp();
    this.write((enqueue) => {
      this.h.run(
        `INSERT INTO routines(id,name,icon,sort_order,archived_at,created_at,updated_at)
         VALUES (?,?,?,?,NULL,?,?)`,
        [id, data.name, data.icon ?? null, data.sortOrder ?? 0, ts, ts],
      );
      enqueue("routines", id, "upsert");
    });
    return this.getRoutine(id);
  }

  getRoutine(id: string): Routine {
    const rows = this.h.rows(`SELECT * FROM routines WHERE id=? AND deleted_at IS NULL`, [id]);
    if (!rows.length) throw new NotFoundError("routine", id);
    return toRoutine(rows[0]);
  }

  listRoutines(opts: { includeArchived?: boolean } = {}): Routine[] {
    const where = opts.includeArchived
      ? "WHERE deleted_at IS NULL"
      : "WHERE deleted_at IS NULL AND archived_at IS NULL";
    return this.h.rows(`SELECT * FROM routines ${where} ORDER BY sort_order, created_at`).map(toRoutine);
  }

  updateRoutine(id: string, patch: UpdateRoutinePatch): Routine {
    const cur = this.getRoutine(id);
    if (patch.name !== undefined) assertName("name", patch.name);
    const next = { ...cur, ...patch };
    this.write((enqueue) => {
      this.h.run(
        `UPDATE routines SET name=?, icon=?, sort_order=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [next.name, next.icon, next.sortOrder, stamp(), id],
      );
      enqueue("routines", id, "upsert");
    });
    return this.getRoutine(id);
  }

  /**
   * Archiving a routine releases its habits (they become standalone) but
   * never archives them — spec §5. Both writes are one transaction so a
   * failure can't leave habits pointing at an archived routine.
   */
  archiveRoutine(id: string): void {
    this.getRoutine(id);
    const ts = stamp();
    this.write((enqueue) => {
      const released = this.releaseHabitsFrom(id, ts);
      this.h.run(
        `UPDATE routines SET archived_at=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [ts, ts, id],
      );
      enqueue("routines", id, "upsert");
      released.forEach((habitId) => enqueue("habits", habitId, "upsert"));
    });
  }

  /**
   * Soft delete with a tombstone (§6). Hard-removing the row would make
   * it indistinguishable from one this device has simply never seen, and
   * the next pull would resurrect it. Reads filter tombstones out, so
   * from Layer 2's side the row is gone exactly as before.
   */
  deleteRoutine(id: string): void {
    this.getRoutine(id);
    const ts = stamp();
    this.write((enqueue) => {
      const released = this.releaseHabitsFrom(id, ts);
      this.h.run(
        `UPDATE routines SET deleted_at=?, updated_at=?, sync_status='pending' WHERE id=?`,
        [ts, ts, id],
      );
      enqueue("routines", id, "delete");
      released.forEach((habitId) => enqueue("habits", habitId, "upsert"));
    });
  }

  /** Detaches a routine's habits, returning the ids that actually moved. */
  private releaseHabitsFrom(routineId: string, ts: string): string[] {
    const ids = this.h.rows(
      `SELECT id FROM habits WHERE routine_id=? AND deleted_at IS NULL`, [routineId],
    ).map((r) => String(r.id));
    if (ids.length) {
      this.h.run(
        `UPDATE habits SET routine_id=NULL, updated_at=?, sync_status='pending'
         WHERE routine_id=? AND deleted_at IS NULL`,
        [ts, routineId],
      );
    }
    return ids;
  }

  reorderRoutines(orderedIds: string[]): void {
    this.assertAllExist("routines", "routine", orderedIds);
    const ts = stamp();
    this.write((enqueue) => {
      orderedIds.forEach((id, i) => {
        this.h.run(
          `UPDATE routines SET sort_order=?, updated_at=?, sync_status='pending' WHERE id=?`,
          [i, ts, id],
        );
        enqueue("routines", id, "upsert");
      });
    });
  }

  // ── Habits ──────────────────────────────────────────────────────────
  createHabit(data: CreateHabitInput): Habit {
    assertName("name", data?.name);
    const targetDirection = data.targetDirection ?? "at_least";
    validateHabitShape({
      type: data.type,
      unit: data.unit ?? null,
      target: data.target ?? null,
      targetDirection,
      frequencyType: data.frequencyType,
      frequencyDays: data.frequencyDays ?? null,
      frequencyCount: data.frequencyCount ?? null,
    });
    if (data.routineId) this.getRoutine(data.routineId);
    const id = uuid();
    const ts = stamp();
    this.write((enqueue) => {
      this.h.run(
        `INSERT INTO habits(id,name,icon,question,type,unit,target,target_direction,frequency_type,
                            frequency_days,frequency_count,routine_id,sort_order,color,reminder_time,
                            archived_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
        [id, data.name, data.icon ?? null, data.question ?? null, data.type, data.unit ?? null,
          data.target ?? null, targetDirection, data.frequencyType,
          data.frequencyDays ? JSON.stringify(data.frequencyDays) : null, data.frequencyCount ?? null,
          data.routineId ?? null, data.sortOrder ?? 0, data.color ?? null, data.reminderTime ?? null, ts, ts],
      );
      enqueue("habits", id, "upsert");
    });
    return this.getHabit(id);
  }

  getHabit(id: string): Habit {
    const rows = this.h.rows(`SELECT * FROM habits WHERE id=? AND deleted_at IS NULL`, [id]);
    if (!rows.length) throw new NotFoundError("habit", id);
    return toHabit(rows[0]);
  }

  listHabits(opts: { includeArchived?: boolean; routineId?: string | null } = {}): Habit[] {
    const clauses: string[] = ["deleted_at IS NULL"];
    const bind: unknown[] = [];
    if (!opts.includeArchived) clauses.push("archived_at IS NULL");
    if (opts.routineId !== undefined) {
      if (opts.routineId === null) clauses.push("routine_id IS NULL");
      else { clauses.push("routine_id=?"); bind.push(opts.routineId); }
    }
    return this.h.rows(
      `SELECT * FROM habits WHERE ${clauses.join(" AND ")} ORDER BY sort_order, created_at`, bind,
    ).map(toHabit);
  }

  /**
   * Type changes are refused once entries exist: the stored values would
   * silently change meaning (spec §6.3). Target and frequency changes are
   * allowed and deliberately do NOT rewrite history — they only change
   * how Layer 2 scores it.
   */
  updateHabit(id: string, patch: UpdateHabitPatch): Habit {
    const cur = this.getHabit(id);
    if (patch.type !== undefined && patch.type !== cur.type && this.getEntryCount(id) > 0) {
      throw new IllegalStateChangeError(
        "type",
        "cannot change a habit's type while entries exist — archive it and create a new habit instead",
      );
    }
    if (patch.name !== undefined) assertName("name", patch.name);
    if (patch.routineId) this.getRoutine(patch.routineId);

    const pick = <K extends keyof UpdateHabitPatch, F>(key: K, fallback: F) =>
      (patch[key] !== undefined ? patch[key] : fallback);

    const shape: HabitShape = {
      type: pick("type", cur.type) as string,
      unit: pick("unit", cur.unit) as string | null,
      target: pick("target", cur.target) as number | null,
      targetDirection: pick("targetDirection", cur.targetDirection) as string,
      frequencyType: pick("frequencyType", cur.frequencyType) as string,
      frequencyDays: pick("frequencyDays", cur.frequencyDays) as number[] | null,
      frequencyCount: pick("frequencyCount", cur.frequencyCount) as number | null,
    };
    validateHabitShape(shape);

    this.write((enqueue) => {
      this.h.run(
        `UPDATE habits SET name=?, icon=?, question=?, type=?, unit=?, target=?, target_direction=?,
                           frequency_type=?, frequency_days=?, frequency_count=?, routine_id=?,
                           sort_order=?, color=?, reminder_time=?, updated_at=?, sync_status='pending'
         WHERE id=?`,
        [
          pick("name", cur.name), pick("icon", cur.icon), pick("question", cur.question),
          shape.type, shape.unit, shape.target, shape.targetDirection, shape.frequencyType,
          shape.frequencyDays ? JSON.stringify(shape.frequencyDays) : null, shape.frequencyCount,
          pick("routineId", cur.routineId), pick("sortOrder", cur.sortOrder),
          pick("color", cur.color), pick("reminderTime", cur.reminderTime), stamp(), id,
        ],
      );
      enqueue("habits", id, "upsert");
    });
    return this.getHabit(id);
  }

  /** Hides the habit, keeps every entry. Reversible, and NOT a tombstone. */
  archiveHabit(id: string): void {
    this.getHabit(id);
    const ts = stamp();
    this.write((enqueue) => {
      this.h.run(
        `UPDATE habits SET archived_at=?, updated_at=?, sync_status='pending' WHERE id=?`, [ts, ts, id],
      );
      enqueue("habits", id, "upsert");
    });
  }

  unarchiveHabit(id: string): void {
    this.getHabit(id);
    this.write((enqueue) => {
      this.h.run(
        `UPDATE habits SET archived_at=NULL, updated_at=?, sync_status='pending' WHERE id=?`, [stamp(), id],
      );
      enqueue("habits", id, "upsert");
    });
  }

  /**
   * Unreachable by a stray tap: the confirmation flag is enforced at the
   * API level (non-negotiable #7).
   *
   * Tombstoned rather than removed (§6), and the entries are tombstoned
   * with it. The ON DELETE CASCADE on the foreign key does not fire for a
   * soft delete, so the cascade is written out — the observable result is
   * the same as before, since every read filters tombstones.
   */
  deleteHabit(id: string, opts: { confirmed?: boolean } = {}): void {
    this.getHabit(id);
    if (!opts.confirmed) throw new ConfirmationRequiredError("deleteHabit");
    const ts = stamp();
    this.write((enqueue) => {
      const entryIds = this.h.rows(
        `SELECT id FROM entries WHERE habit_id=? AND deleted_at IS NULL`, [id],
      ).map((r) => String(r.id));
      this.h.run(
        `UPDATE entries SET deleted_at=?, updated_at=?, sync_status='pending'
         WHERE habit_id=? AND deleted_at IS NULL`,
        [ts, ts, id],
      );
      this.h.run(
        `UPDATE habits SET deleted_at=?, updated_at=?, sync_status='pending' WHERE id=?`, [ts, ts, id],
      );
      entryIds.forEach((entryId) => enqueue("entries", entryId, "delete"));
      enqueue("habits", id, "delete");
    });
  }

  reorderHabits(orderedIds: string[]): void {
    this.assertAllExist("habits", "habit", orderedIds);
    const ts = stamp();
    this.write((enqueue) => {
      orderedIds.forEach((id, i) => {
        this.h.run(
          `UPDATE habits SET sort_order=?, updated_at=?, sync_status='pending' WHERE id=?`, [i, ts, id],
        );
        enqueue("habits", id, "upsert");
      });
    });
  }

  private assertAllExist(table: "habits" | "routines", entity: string, ids: string[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(",");
    const found = new Set(
      this.h.rows(
        `SELECT id FROM ${table} WHERE id IN (${placeholders}) AND deleted_at IS NULL`, ids,
      ).map((r) => String(r.id)),
    );
    const missing = ids.find((id) => !found.has(id));
    if (missing) throw new NotFoundError(entity, missing);
  }

  // ── Entries ─────────────────────────────────────────────────────────
  getEntry(habitId: string, date: string): Entry | null {
    const rows = this.h.rows(
      `SELECT * FROM entries WHERE habit_id=? AND date=? AND deleted_at IS NULL`, [habitId, date],
    );
    return rows.length ? toEntry(rows[0]) : null;
  }

  getEntriesForHabit(habitId: string, startDate: string, endDate: string): Entry[] {
    assertDateString("startDate", startDate);
    assertDateString("endDate", endDate);
    return this.h.rows(
      `SELECT * FROM entries WHERE habit_id=? AND date>=? AND date<=? AND deleted_at IS NULL
       ORDER BY date`,
      [habitId, startDate, endDate],
    ).map(toEntry);
  }

  getEntriesForDate(date: string): Entry[] {
    assertDateString("date", date);
    return this.h.rows(
      `SELECT * FROM entries WHERE date=? AND deleted_at IS NULL ORDER BY habit_id`, [date],
    ).map(toEntry);
  }

  /** One statement regardless of habit count — the list view depends on this. */
  getEntriesForHabits(habitIds: string[], startDate: string, endDate: string): Entry[] {
    assertDateString("startDate", startDate);
    assertDateString("endDate", endDate);
    if (!habitIds.length) return [];
    const placeholders = habitIds.map(() => "?").join(",");
    return this.h.rows(
      `SELECT * FROM entries WHERE habit_id IN (${placeholders}) AND date>=? AND date<=?
         AND deleted_at IS NULL
       ORDER BY habit_id, date`,
      [...habitIds, startDate, endDate],
    ).map(toEntry);
  }

  /**
   * True atomic upsert (spec §6.1) — never read-then-write, which can
   * race and either violate the constraint or lose an update. On the
   * conflict branch, id and created_at are untouched; only value, note
   * and updated_at move.
   */
  setEntry(habitId: string, date: string, value: number, note: string | null = null): Entry {
    this.getHabit(habitId);
    assertDateString("date", date);
    assertEntryValue(value);
    const ts = stamp();
    const entry = this.write((enqueue) => {
      this.h.run(
        `INSERT INTO entries(id,habit_id,date,value,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(habit_id,date) DO UPDATE
           SET value=excluded.value, note=excluded.note, updated_at=excluded.updated_at,
               deleted_at=NULL, sync_status='pending'`,
        [uuid(), habitId, date, value, note, ts, ts],
      );
      // Clearing deleted_at above is what makes a re-logged day revive the
      // existing row rather than collide with its tombstone: the UNIQUE
      // index does not care that a row is dead, so there is only ever one
      // row per habit-day and the constraint stays meaningful.
      const row = this.getEntryRow(habitId, date);
      enqueue("entries", String(row.id), "upsert");
      return toEntry(row);
    });
    return entry;
  }

  /**
   * Tombstone, not DELETE (§6). A removed row is indistinguishable from
   * one this device has never seen, so the next pull would resurrect it
   * forever. Reads filter tombstones, so getEntry still returns null and
   * the tri-state model Layer 1 §4.4 defines is unchanged from above.
   */
  deleteEntry(habitId: string, date: string): void {
    assertDateString("date", date);
    const rows = this.h.rows(
      `SELECT id FROM entries WHERE habit_id=? AND date=? AND deleted_at IS NULL`, [habitId, date],
    );
    if (!rows.length) return;
    const id = String(rows[0].id);
    const ts = stamp();
    this.write((enqueue) => {
      this.h.run(
        `UPDATE entries SET deleted_at=?, updated_at=?, sync_status='pending' WHERE id=?`, [ts, ts, id],
      );
      enqueue("entries", id, "delete");
    });
  }

  private getEntryRow(habitId: string, date: string): Record<string, unknown> {
    const rows = this.h.rows(
      `SELECT * FROM entries WHERE habit_id=? AND date=? AND deleted_at IS NULL`, [habitId, date],
    );
    if (!rows.length) throw new NotFoundError("entry", `${habitId}@${date}`);
    return rows[0];
  }

  getFirstEntryDate(habitId: string): string | null {
    const v = this.h.one(
      `SELECT MIN(date) FROM entries WHERE habit_id=? AND deleted_at IS NULL`, [habitId],
    );
    return v == null ? null : String(v);
  }

  getEntryCount(habitId: string): number {
    return Number(this.h.one(
      `SELECT COUNT(*) FROM entries WHERE habit_id=? AND deleted_at IS NULL`, [habitId],
    ));
  }

  // ── Settings & utility ──────────────────────────────────────────────
  getDayStartHour(): number {
    const v = this.h.one(`SELECT value FROM meta WHERE key='day_start_hour'`);
    return v == null ? 4 : parseInt(String(v), 10);
  }

  /** Writes meta only. Existing entries are never re-dated (spec §3.1 rule 2). */
  setDayStartHour(hour: number): void {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new ValidationError("dayStartHour", hour, "must be an integer from 0 to 23");
    }
    this.setMeta("day_start_hour", String(hour));
  }

  getMeta(key: string): string | null {
    const v = this.h.one(`SELECT value FROM meta WHERE key=?`, [key]);
    return v == null ? null : String(v);
  }

  setMeta(key: string, value: string): void {
    this.h.run(
      `INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, value],
    );
  }

  /**
   * THE definition of "today" (spec §3.1). A habit-day runs from
   * day_start_hour to day_start_hour the next day, so a 01:30 log after a
   * late shift belongs to the day that just ended. This offset applies
   * only here — stored dates are never re-interpreted, and a date the
   * user picks explicitly is used exactly as picked.
   */
  getToday(): string {
    const dayStartHour = this.getDayStartHour();
    const instant = now();
    const effective = new Date(instant);
    if (instant.getHours() < dayStartHour) effective.setDate(effective.getDate() - 1);
    return localDateStr(effective);
  }

  /**
   * Spec §5 and §9.7 test 33. Runs several writes as one unit: if the
   * callback throws, nothing it did survives.
   *
   * The callback names the operations rather than receiving a handle,
   * because a handle would have to cross the Worker boundary and would
   * let the caller hold a live transaction open across a postMessage
   * round trip — long enough for another tab to block on it.
   */
  runTransaction(ops: Array<{ method: string; args: unknown[] }>): unknown[] {
    const results: unknown[] = [];
    this.inTransaction(() => {
      for (const op of ops) {
        const fn = (this as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[op.method];
        if (typeof fn !== "function" || op.method.startsWith("__") || op.method === "runTransaction") {
          throw new ValidationError("method", op.method, "is not a transactable repository method");
        }
        results.push(fn.apply(this, op.args));
      }
    });
    return results;
  }

  /** Spec §9.8 test 38. Returns the query plan for a statement. */
  __explain(sql: string, bind: unknown[] = []): string[] {
    return this.h.rows(`EXPLAIN QUERY PLAN ${sql}`, bind).map((r) => String(r.detail ?? JSON.stringify(r)));
  }

  /** Total rows, used to tell an empty database from an evicted one. */
  __rowCounts(): { habits: number; routines: number; entries: number } {
    return {
      habits: Number(this.h.one(`SELECT COUNT(*) FROM habits`)),
      routines: Number(this.h.one(`SELECT COUNT(*) FROM routines`)),
      entries: Number(this.h.one(`SELECT COUNT(*) FROM entries`)),
    };
  }

  // ── Sync queue (Layer 1b §4.2, §8) ──────────────────────────────────
  /** Rows waiting to reach the server. The UI may see this count (§8). */
  getPendingCount(): number {
    return Number(this.h.one(`SELECT COUNT(*) FROM sync_queue`));
  }

  /** A row exactly as stored, tombstones included. Used by pull to compare. */
  getRawRow(table: SyncTable, id: string): Record<string, unknown> | null {
    const rows = this.h.rows(`SELECT * FROM ${table} WHERE id=?`, [id]);
    return rows.length ? rows[0] : null;
  }

  /**
   * Writes a row that came from the server. Deliberately does NOT enqueue:
   * pushing back what was just pulled would loop forever. The row is
   * marked `synced` because, by definition, it is.
   *
   * Unknown keys are dropped rather than passed through — the server may
   * carry columns this client's schema does not have yet, and an INSERT
   * naming one would fail outright.
   */
  applyRemoteRow(table: SyncTable, row: Record<string, unknown>): void {
    const cols = SYNCED_COLUMNS[table].filter((c) => c in row);
    if (!cols.includes("id")) throw new ValidationError("id", row.id, "a pulled row must carry its id");
    const assignments = cols.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`);
    this.h.run(
      `INSERT INTO ${table}(${cols.join(",")},sync_status)
       VALUES (${cols.map(() => "?").join(",")},'synced')
       ON CONFLICT(id) DO UPDATE SET ${assignments.join(",")}, sync_status='synced'`,
      cols.map((c) => row[c] ?? null),
    );
  }

  /** The queue in insertion order — the order it must drain in. */
  peekSyncQueue(limit: number): SyncQueueItem[] {
    return this.h.rows(
      `SELECT * FROM sync_queue ORDER BY id LIMIT ?`, [limit],
    ).map((r) => ({
      id: Number(r.id),
      tableName: r.table_name as SyncTable,
      recordId: String(r.record_id),
      operation: r.operation as SyncOperation,
      payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
      attempts: Number(r.attempts),
      lastError: (r.last_error as string) ?? null,
      createdAt: String(r.created_at),
    }));
  }

  /** A queue item that reached the server: drop it, mark the row synced. */
  resolveSyncItem(queueId: number, table: SyncTable, recordId: string): void {
    this.inTransaction(() => {
      this.h.run(`DELETE FROM sync_queue WHERE id=?`, [queueId]);
      // Only if nothing newer is still queued for the same row — otherwise
      // "synced" would be a lie about the version now on disk.
      const stillQueued = Number(this.h.one(
        `SELECT COUNT(*) FROM sync_queue WHERE table_name=? AND record_id=?`, [table, recordId],
      ));
      if (!stillQueued) {
        this.h.run(`UPDATE ${table} SET sync_status='synced' WHERE id=?`, [recordId]);
      }
    });
  }

  /**
   * A push that failed. Network failures leave the item queued to retry;
   * a server rejection is a conflict, which is recorded on the row and
   * surfaced rather than dropped (§7.1, non-negotiable #6).
   */
  failSyncItem(queueId: number, message: string, kind: "retry" | "conflict"): void {
    this.inTransaction(() => {
      this.h.run(
        `UPDATE sync_queue SET attempts=attempts+1, last_error=? WHERE id=?`, [message, queueId],
      );
      if (kind === "conflict") {
        const rows = this.h.rows(`SELECT table_name, record_id FROM sync_queue WHERE id=?`, [queueId]);
        if (rows.length) {
          const table = String(rows[0].table_name) as SyncTable;
          this.h.run(`UPDATE ${table} SET sync_status='conflict' WHERE id=?`, [String(rows[0].record_id)]);
        }
      }
    });
  }

  /** Rows the server rejected, for the UI to surface rather than bury. */
  getConflictCount(): number {
    return (["habits", "routines", "entries"] as SyncTable[]).reduce(
      (n, t) => n + Number(this.h.one(`SELECT COUNT(*) FROM ${t} WHERE sync_status='conflict'`)),
      0,
    );
  }

  /**
   * Drops tombstones older than 90 days, but only ones the server has
   * acknowledged (§6). Purging an unsynced tombstone would let the row
   * come back on the next pull, which is the exact bug tombstones exist
   * to prevent.
   */
  purgeTombstones(olderThan: string): number {
    let removed = 0;
    this.inTransaction(() => {
      for (const table of ["entries", "habits", "routines"] as SyncTable[]) {
        const ids = this.h.rows(
          `SELECT id FROM ${table}
           WHERE deleted_at IS NOT NULL AND deleted_at < ? AND sync_status='synced'
             AND id NOT IN (SELECT record_id FROM sync_queue WHERE table_name=?)`,
          [olderThan, table],
        ).map((r) => String(r.id));
        if (!ids.length) continue;
        this.h.run(
          `DELETE FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids,
        );
        removed += ids.length;
      }
    });
    return removed;
  }

  // ── Test-only seams ─────────────────────────────────────────────────
  /** Entries as the app sees them — tombstones excluded, like every read. */
  __dumpEntries(): Entry[] {
    return this.h.rows(
      `SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY habit_id, date`,
    ).map(toEntry);
  }

  /** Raw rows including tombstones, so a test can prove one exists. */
  __dumpRaw(table: SyncTable): Record<string, unknown>[] {
    return this.h.rows(`SELECT * FROM ${table} ORDER BY id`);
  }

  /** See Db.__rawInsertEntry — deliberately omits ON CONFLICT. */
  __rawInsertEntry(habitId: string, date: string, value: number): void {
    const ts = stamp();
    this.h.run(
      `INSERT INTO entries(id,habit_id,date,value,note,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?)`,
      [uuid(), habitId, date, value, ts, ts],
    );
  }
}

const SQLITE_CONSTRAINT = 19;
const SQLITE_FULL = 13;
const SQLITE_IOERR = 10;

/**
 * Converts a raw sqlite3 failure into a typed error. Explicit checks
 * above catch most bad input first; this is the net for anything only the
 * schema knows (UNIQUE, FK, CHECK), so callers never see an untyped
 * SQLite exception.
 */
export function translateSqlError(err: unknown): never {
  const e = err as { resultCode?: number; message?: string; name?: string };
  const code = typeof e?.resultCode === "number" ? e.resultCode & 0xff : null;
  const message = e?.message || String(err);

  if (code === SQLITE_CONSTRAINT) {
    throw new ConstraintError("sqlite", message);
  }
  // Running out of room reaches us either as SQLITE_FULL, or as an I/O
  // error wrapping the browser's own QuotaExceededError from the VFS.
  // Both mean the same thing to the user and neither is a data bug, so
  // both get the name that lets the UI say "storage is full".
  if (code === SQLITE_FULL || e?.name === "QuotaExceededError"
      || (code === SQLITE_IOERR && /quota/i.test(message))
      || /quota|disk (is )?full|no space/i.test(message)) {
    throw new QuotaExceededError(message);
  }
  throw err as Error;
}
