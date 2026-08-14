// The SQL implementation of every Layer 1 method. Runs inside the Worker
// (worker.ts), against a live sqlite3 OO1 database handle. Nothing outside
// this file writes raw SQL — worker.ts only dispatches RPC calls to these
// functions, and the main-thread client (client.ts) only calls worker.ts
// through postMessage. This is the one place the current instant is
// reachable (via clock.ts's now()), and getToday() below is the only
// function that applies the day-start-hour offset.
import { runMigrations } from "./migrations.js";
import { now } from "./clock.js";
import { ValidationError, NotFoundError, ConstraintError, ConfirmationRequiredError, IllegalStateChangeError } from "./errors.js";
import type {
  Routine, Habit, Entry, CreateRoutineInput, UpdateRoutinePatch,
  CreateHabitInput, UpdateHabitPatch, FrequencyType,
} from "./types.js";

// Narrow surface this file needs from the sqlite3 OO1 Database instance —
// keeps this module decoupled from the concrete sqlite3 package types.
export interface SqlDb {
  exec(sqlOrOpts: string | { sql: string; bind?: unknown }): unknown;
  selectObjects(sql: string, bind?: unknown): Record<string, unknown>[];
  selectValue(sql: string, bind?: unknown): unknown;
  changes(): number;
  transaction<T>(cb: (db: SqlDb) => T): T;
}

let queryCount = 0;
export function __getQueryCount(): number { return queryCount; }
export function __resetQueryCount(): void { queryCount = 0; }

function mkHelpers(db: SqlDb) {
  return {
    exec(sql: string, bind?: unknown[]): void {
      queryCount++;
      if (bind) db.exec({ sql, bind });
      else db.exec(sql);
    },
    rows(sql: string, bind?: unknown[]): Record<string, unknown>[] {
      queryCount++;
      return db.selectObjects(sql, bind);
    },
    value(sql: string, bind?: unknown[]): unknown {
      queryCount++;
      return db.selectValue(sql, bind);
    },
  };
}

const uuid = (): string => crypto.randomUUID();
const iso = (): string => now().toISOString();

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
// Local (not UTC) calendar date string, per spec §3: never toISOString().
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ── Row <-> domain mapping ────────────────────────────────────────────
function rowToRoutine(r: Record<string, unknown>): Routine {
  return {
    id: String(r.id), name: String(r.name), icon: (r.icon as string) ?? null,
    sortOrder: Number(r.sort_order), archivedAt: (r.archived_at as string) ?? null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}
function rowToHabit(r: Record<string, unknown>): Habit {
  return {
    id: String(r.id), name: String(r.name), icon: (r.icon as string) ?? null,
    question: (r.question as string) ?? null, type: r.type as Habit["type"],
    unit: (r.unit as string) ?? null, target: r.target == null ? null : Number(r.target),
    targetDirection: r.target_direction as Habit["targetDirection"],
    frequencyType: r.frequency_type as FrequencyType,
    frequencyDays: r.frequency_days ? (JSON.parse(String(r.frequency_days)) as number[]) : null,
    frequencyCount: r.frequency_count == null ? null : Number(r.frequency_count),
    routineId: (r.routine_id as string) ?? null, sortOrder: Number(r.sort_order),
    color: (r.color as string) ?? null, reminderTime: (r.reminder_time as string) ?? null,
    archivedAt: (r.archived_at as string) ?? null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}
function rowToEntry(r: Record<string, unknown>): Entry {
  return {
    id: String(r.id), habitId: String(r.habit_id), date: String(r.date),
    value: Number(r.value), note: (r.note as string) ?? null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

// ── Validation (spec §4.2) ─────────────────────────────────────────────
const FREQUENCY_TYPES: FrequencyType[] = ["daily", "specific_days", "times_per_week", "times_per_month"];

function validateHabitShape(h: {
  type: string; unit: string | null; target: number | null;
  frequencyType: string; frequencyDays: number[] | null; frequencyCount: number | null;
}): void {
  if (h.type !== "boolean" && h.type !== "numeric") {
    throw new ValidationError("type", h.type, "must be 'boolean' or 'numeric'");
  }
  if (h.type === "numeric" && h.target == null) {
    throw new ValidationError("target", h.target, "numeric habits require a target");
  }
  if (h.type === "boolean" && h.target != null) {
    throw new ValidationError("target", h.target, "boolean habits must not have a target");
  }
  if (h.type === "boolean" && h.unit != null) {
    throw new ValidationError("unit", h.unit, "boolean habits must not have a unit");
  }
  if (!FREQUENCY_TYPES.includes(h.frequencyType as FrequencyType)) {
    throw new ValidationError("frequencyType", h.frequencyType, `must be one of ${FREQUENCY_TYPES.join(", ")}`);
  }
  if (h.frequencyType === "specific_days") {
    const days = h.frequencyDays;
    const valid = Array.isArray(days) && days.length >= 1
      && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      && new Set(days).size === days.length;
    if (!valid) {
      throw new ValidationError("frequencyDays", days, "specific_days requires a non-empty array of unique integers 0-6");
    }
  } else if (h.frequencyDays != null) {
    throw new ValidationError("frequencyDays", h.frequencyDays, `must be null unless frequencyType is 'specific_days'`);
  }
  if (h.frequencyType === "times_per_week" || h.frequencyType === "times_per_month") {
    if (!(Number.isInteger(h.frequencyCount) && (h.frequencyCount as number) >= 1)) {
      throw new ValidationError("frequencyCount", h.frequencyCount, `${h.frequencyType} requires an integer >= 1`);
    }
  } else if (h.frequencyCount != null) {
    throw new ValidationError("frequencyCount", h.frequencyCount, `must be null unless frequencyType is times_per_week/times_per_month`);
  }
}

export class Repository {
  private db: SqlDb;
  private h: ReturnType<typeof mkHelpers>;

  constructor(db: SqlDb) {
    this.db = db;
    this.h = mkHelpers(db);
    runMigrations(db as unknown as Parameters<typeof runMigrations>[0]);
  }

  // ── Routines ──────────────────────────────────────────────────────
  createRoutine(data: CreateRoutineInput): Routine {
    if (!data.name || !data.name.trim()) throw new ValidationError("name", data.name, "routine name is required");
    const id = uuid();
    const ts = iso();
    this.h.exec(
      `INSERT INTO routines(id,name,icon,sort_order,archived_at,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?)`,
      [id, data.name, data.icon ?? null, data.sortOrder ?? 0, ts, ts],
    );
    return this.getRoutine(id);
  }

  getRoutine(id: string): Routine {
    const rows = this.h.rows(`SELECT * FROM routines WHERE id = ?`, [id]);
    if (rows.length === 0) throw new NotFoundError("routine", id);
    return rowToRoutine(rows[0]);
  }

  listRoutines(opts: { includeArchived?: boolean } = {}): Routine[] {
    const sql = opts.includeArchived
      ? `SELECT * FROM routines ORDER BY sort_order, created_at`
      : `SELECT * FROM routines WHERE archived_at IS NULL ORDER BY sort_order, created_at`;
    return this.h.rows(sql).map(rowToRoutine);
  }

  updateRoutine(id: string, patch: UpdateRoutinePatch): Routine {
    const current = this.getRoutine(id);
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError("name", patch.name, "routine name is required");
    const next = { ...current, ...patch };
    this.h.exec(`UPDATE routines SET name=?, icon=?, sort_order=?, updated_at=? WHERE id=?`,
      [next.name, next.icon, next.sortOrder, iso(), id]);
    return this.getRoutine(id);
  }

  archiveRoutine(id: string): void {
    this.getRoutine(id); // throws NotFoundError if missing
    this.db.transaction((tx) => {
      const h = mkHelpers(tx);
      h.exec(`UPDATE habits SET routine_id=NULL, updated_at=? WHERE routine_id=?`, [iso(), id]);
      h.exec(`UPDATE routines SET archived_at=?, updated_at=? WHERE id=?`, [iso(), iso(), id]);
    });
  }

  deleteRoutine(id: string): void {
    this.getRoutine(id);
    this.db.transaction((tx) => {
      const h = mkHelpers(tx);
      h.exec(`UPDATE habits SET routine_id=NULL, updated_at=? WHERE routine_id=?`, [iso(), id]);
      h.exec(`DELETE FROM routines WHERE id=?`, [id]);
    });
  }

  reorderRoutines(orderedIds: string[]): void {
    this.db.transaction((tx) => {
      const h = mkHelpers(tx);
      orderedIds.forEach((id, i) => {
        h.exec(`UPDATE routines SET sort_order=?, updated_at=? WHERE id=?`, [i, iso(), id]);
        if (this.db.changes() === 0) throw new NotFoundError("routine", id);
      });
    });
  }

  // ── Habits ────────────────────────────────────────────────────────
  createHabit(data: CreateHabitInput): Habit {
    if (!data.name || !data.name.trim()) throw new ValidationError("name", data.name, "habit name is required");
    const targetDirection = data.targetDirection ?? "at_least";
    validateHabitShape({
      type: data.type, unit: data.unit ?? null, target: data.target ?? null,
      frequencyType: data.frequencyType, frequencyDays: data.frequencyDays ?? null, frequencyCount: data.frequencyCount ?? null,
    });
    if (data.routineId) this.getRoutine(data.routineId); // throws if it doesn't exist
    const id = uuid();
    const ts = iso();
    this.h.exec(
      `INSERT INTO habits(id,name,icon,question,type,unit,target,target_direction,frequency_type,frequency_days,frequency_count,routine_id,sort_order,color,reminder_time,archived_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
      [id, data.name, data.icon ?? null, data.question ?? null, data.type, data.unit ?? null, data.target ?? null,
        targetDirection, data.frequencyType, data.frequencyDays ? JSON.stringify(data.frequencyDays) : null,
        data.frequencyCount ?? null, data.routineId ?? null, data.sortOrder ?? 0, data.color ?? null,
        data.reminderTime ?? null, ts, ts],
    );
    return this.getHabit(id);
  }

  getHabit(id: string): Habit {
    const rows = this.h.rows(`SELECT * FROM habits WHERE id = ?`, [id]);
    if (rows.length === 0) throw new NotFoundError("habit", id);
    return rowToHabit(rows[0]);
  }

  listHabits(opts: { includeArchived?: boolean; routineId?: string | null } = {}): Habit[] {
    const clauses: string[] = [];
    const bind: unknown[] = [];
    if (!opts.includeArchived) clauses.push(`archived_at IS NULL`);
    if (opts.routineId !== undefined) {
      if (opts.routineId === null) clauses.push(`routine_id IS NULL`);
      else { clauses.push(`routine_id = ?`); bind.push(opts.routineId); }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.h.rows(`SELECT * FROM habits ${where} ORDER BY sort_order, created_at`, bind).map(rowToHabit);
  }

  updateHabit(id: string, patch: UpdateHabitPatch): Habit {
    const current = this.getHabit(id);
    if (patch.type !== undefined && patch.type !== current.type) {
      const count = Number(this.h.value(`SELECT COUNT(*) FROM entries WHERE habit_id=?`, [id]));
      if (count > 0) throw new IllegalStateChangeError("type", "cannot change type while entries exist — archive and create a new habit instead");
    }
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError("name", patch.name, "habit name is required");
    if (patch.routineId) this.getRoutine(patch.routineId);
    const merged = {
      type: patch.type ?? current.type,
      unit: patch.unit !== undefined ? patch.unit : current.unit,
      target: patch.target !== undefined ? patch.target : current.target,
      targetDirection: patch.targetDirection ?? current.targetDirection,
      frequencyType: patch.frequencyType ?? current.frequencyType,
      frequencyDays: patch.frequencyDays !== undefined ? patch.frequencyDays : current.frequencyDays,
      frequencyCount: patch.frequencyCount !== undefined ? patch.frequencyCount : current.frequencyCount,
    };
    validateHabitShape(merged);
    const next: Habit = {
      ...current,
      name: patch.name ?? current.name,
      icon: patch.icon !== undefined ? patch.icon : current.icon,
      question: patch.question !== undefined ? patch.question : current.question,
      ...merged,
      routineId: patch.routineId !== undefined ? patch.routineId : current.routineId,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      color: patch.color !== undefined ? patch.color : current.color,
      reminderTime: patch.reminderTime !== undefined ? patch.reminderTime : current.reminderTime,
    };
    this.h.exec(
      `UPDATE habits SET name=?, icon=?, question=?, type=?, unit=?, target=?, target_direction=?, frequency_type=?, frequency_days=?, frequency_count=?, routine_id=?, sort_order=?, color=?, reminder_time=?, updated_at=? WHERE id=?`,
      [next.name, next.icon, next.question, next.type, next.unit, next.target, next.targetDirection,
        next.frequencyType, next.frequencyDays ? JSON.stringify(next.frequencyDays) : null, next.frequencyCount,
        next.routineId, next.sortOrder, next.color, next.reminderTime, iso(), id],
    );
    return this.getHabit(id);
  }

  archiveHabit(id: string): void {
    this.getHabit(id);
    this.h.exec(`UPDATE habits SET archived_at=?, updated_at=? WHERE id=?`, [iso(), iso(), id]);
  }

  unarchiveHabit(id: string): void {
    this.getHabit(id);
    this.h.exec(`UPDATE habits SET archived_at=NULL, updated_at=? WHERE id=?`, [iso(), id]);
  }

  deleteHabit(id: string, opts: { confirmed?: boolean } = {}): void {
    this.getHabit(id);
    if (!opts.confirmed) throw new ConfirmationRequiredError("deleteHabit");
    this.h.exec(`DELETE FROM habits WHERE id=?`, [id]); // ON DELETE CASCADE removes entries
  }

  reorderHabits(orderedIds: string[]): void {
    this.db.transaction((tx) => {
      const h = mkHelpers(tx);
      orderedIds.forEach((id, i) => {
        h.exec(`UPDATE habits SET sort_order=?, updated_at=? WHERE id=?`, [i, iso(), id]);
        if (this.db.changes() === 0) throw new NotFoundError("habit", id);
      });
    });
  }

  // ── Entries ───────────────────────────────────────────────────────
  getEntry(habitId: string, date: string): Entry | null {
    const rows = this.h.rows(`SELECT * FROM entries WHERE habit_id=? AND date=?`, [habitId, date]);
    return rows.length ? rowToEntry(rows[0]) : null;
  }

  getEntriesForHabit(habitId: string, startDate: string, endDate: string): Entry[] {
    return this.h.rows(
      `SELECT * FROM entries WHERE habit_id=? AND date>=? AND date<=? ORDER BY date`,
      [habitId, startDate, endDate],
    ).map(rowToEntry);
  }

  getEntriesForDate(date: string): Entry[] {
    return this.h.rows(`SELECT * FROM entries WHERE date=? ORDER BY habit_id`, [date]).map(rowToEntry);
  }

  getEntriesForHabits(habitIds: string[], startDate: string, endDate: string): Entry[] {
    if (habitIds.length === 0) return [];
    const placeholders = habitIds.map(() => "?").join(",");
    return this.h.rows(
      `SELECT * FROM entries WHERE habit_id IN (${placeholders}) AND date>=? AND date<=? ORDER BY habit_id, date`,
      [...habitIds, startDate, endDate],
    ).map(rowToEntry);
  }

  setEntry(habitId: string, date: string, value: number, note: string | null = null): Entry {
    this.getHabit(habitId); // NotFoundError if the habit doesn't exist
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("date", date, "must be YYYY-MM-DD");
    if (typeof value !== "number" || Number.isNaN(value)) throw new ValidationError("value", value, "must be a number");
    const id = uuid();
    const ts = iso();
    // True atomic upsert (§6.1): INSERT ... ON CONFLICT DO UPDATE, never
    // read-then-write. created_at only applies on the insert branch, so it
    // is preserved across updates; id is likewise untouched on conflict.
    this.h.exec(
      `INSERT INTO entries(id,habit_id,date,value,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(habit_id,date) DO UPDATE SET value=excluded.value, note=excluded.note, updated_at=excluded.updated_at`,
      [id, habitId, date, value, note, ts, ts],
    );
    return this.getEntry(habitId, date) as Entry;
  }

  deleteEntry(habitId: string, date: string): void {
    this.h.exec(`DELETE FROM entries WHERE habit_id=? AND date=?`, [habitId, date]);
  }

  getFirstEntryDate(habitId: string): string | null {
    const v = this.h.value(`SELECT MIN(date) FROM entries WHERE habit_id=?`, [habitId]);
    return v == null ? null : String(v);
  }

  getEntryCount(habitId: string): number {
    return Number(this.h.value(`SELECT COUNT(*) FROM entries WHERE habit_id=?`, [habitId]));
  }

  // ── Utility & settings ───────────────────────────────────────────
  getDayStartHour(): number {
    const v = this.h.value(`SELECT value FROM meta WHERE key='day_start_hour'`);
    return v == null ? 4 : parseInt(String(v), 10);
  }

  setDayStartHour(hour: number): void {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new ValidationError("dayStartHour", hour, "must be an integer between 0 and 23");
    }
    // Only ever changes the meta row — never touches entries (§3.1 rule 2).
    this.h.exec(`INSERT INTO meta(key,value) VALUES ('day_start_hour',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(hour)]);
  }

  getMeta(key: string): string | null {
    const v = this.h.value(`SELECT value FROM meta WHERE key=?`, [key]);
    return v == null ? null : String(v);
  }

  setMeta(key: string, value: string): void {
    this.h.exec(`INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value]);
  }

  // The single definition of "today" (§3.1). Every other piece of code
  // calls this — never construct a fresh Date-of-now directly outside this
  // method and clock.ts.
  getToday(): string {
    const dayStartHour = this.getDayStartHour();
    const n = now();
    const effective = new Date(n);
    if (n.getHours() < dayStartHour) effective.setDate(effective.getDate() - 1);
    return localDateStr(effective);
  }

  __dumpEntries(): Entry[] {
    return this.h.rows(`SELECT * FROM entries ORDER BY habit_id, date`).map(rowToEntry);
  }
}

// Translate a raw SQLite constraint violation into our typed ConstraintError.
// Used by worker.ts's dispatcher as a catch-all safety net around every
// call — the explicit pre-checks above (getHabit/getRoutine existence,
// validateHabitShape) are what most callers will actually hit, but this
// still exists to catch anything a check-constraint enforces that JS
// validation didn't (e.g. `type` collation edge cases) rather than let a
// raw, unhelpful SQLite error escape to the caller.
export function translateSqlError(err: unknown): never {
  const anyErr = err as { resultCode?: number; message?: string };
  if (typeof anyErr?.resultCode === "number" && (anyErr.resultCode & 0xff) === 19 /* SQLITE_CONSTRAINT */) {
    throw new ConstraintError("sqlite", anyErr.message || "constraint violation");
  }
  throw err as Error;
}
