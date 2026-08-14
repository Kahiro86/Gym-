// Every SQL statement in the application lives in this file. It runs
// inside the Web Worker against a live sqlite3 OO1 handle; worker.ts only
// dispatches RPC calls to these methods, and client.ts only talks to
// worker.ts over postMessage. Nothing upstairs writes SQL.
import { runMigrations } from "./migrations.js";
import { now } from "./clock.js";
import {
  ValidationError, NotFoundError, ConstraintError,
  ConfirmationRequiredError, IllegalStateChangeError,
} from "./errors.js";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // ── Routines ────────────────────────────────────────────────────────
  createRoutine(data: CreateRoutineInput): Routine {
    if (!data?.name?.trim()) throw new ValidationError("name", data?.name, "routine name is required");
    const id = uuid();
    const ts = stamp();
    this.h.run(
      `INSERT INTO routines(id,name,icon,sort_order,archived_at,created_at,updated_at)
       VALUES (?,?,?,?,NULL,?,?)`,
      [id, data.name, data.icon ?? null, data.sortOrder ?? 0, ts, ts],
    );
    return this.getRoutine(id);
  }

  getRoutine(id: string): Routine {
    const rows = this.h.rows(`SELECT * FROM routines WHERE id=?`, [id]);
    if (!rows.length) throw new NotFoundError("routine", id);
    return toRoutine(rows[0]);
  }

  listRoutines(opts: { includeArchived?: boolean } = {}): Routine[] {
    const where = opts.includeArchived ? "" : "WHERE archived_at IS NULL";
    return this.h.rows(`SELECT * FROM routines ${where} ORDER BY sort_order, created_at`).map(toRoutine);
  }

  updateRoutine(id: string, patch: UpdateRoutinePatch): Routine {
    const cur = this.getRoutine(id);
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new ValidationError("name", patch.name, "routine name is required");
    }
    const next = { ...cur, ...patch };
    this.h.run(`UPDATE routines SET name=?, icon=?, sort_order=?, updated_at=? WHERE id=?`,
      [next.name, next.icon, next.sortOrder, stamp(), id]);
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
    this.db.transaction((tx) => {
      const h = helpers(tx);
      h.run(`UPDATE habits SET routine_id=NULL, updated_at=? WHERE routine_id=?`, [ts, id]);
      h.run(`UPDATE routines SET archived_at=?, updated_at=? WHERE id=?`, [ts, ts, id]);
    });
  }

  deleteRoutine(id: string): void {
    this.getRoutine(id);
    const ts = stamp();
    this.db.transaction((tx) => {
      const h = helpers(tx);
      h.run(`UPDATE habits SET routine_id=NULL, updated_at=? WHERE routine_id=?`, [ts, id]);
      h.run(`DELETE FROM routines WHERE id=?`, [id]);
    });
  }

  reorderRoutines(orderedIds: string[]): void {
    this.assertAllExist("routines", "routine", orderedIds);
    const ts = stamp();
    this.db.transaction((tx) => {
      const h = helpers(tx);
      orderedIds.forEach((id, i) => h.run(`UPDATE routines SET sort_order=?, updated_at=? WHERE id=?`, [i, ts, id]));
    });
  }

  // ── Habits ──────────────────────────────────────────────────────────
  createHabit(data: CreateHabitInput): Habit {
    if (!data?.name?.trim()) throw new ValidationError("name", data?.name, "habit name is required");
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
    return this.getHabit(id);
  }

  getHabit(id: string): Habit {
    const rows = this.h.rows(`SELECT * FROM habits WHERE id=?`, [id]);
    if (!rows.length) throw new NotFoundError("habit", id);
    return toHabit(rows[0]);
  }

  listHabits(opts: { includeArchived?: boolean; routineId?: string | null } = {}): Habit[] {
    const clauses: string[] = [];
    const bind: unknown[] = [];
    if (!opts.includeArchived) clauses.push("archived_at IS NULL");
    if (opts.routineId !== undefined) {
      if (opts.routineId === null) clauses.push("routine_id IS NULL");
      else { clauses.push("routine_id=?"); bind.push(opts.routineId); }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.h.rows(`SELECT * FROM habits ${where} ORDER BY sort_order, created_at`, bind).map(toHabit);
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
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new ValidationError("name", patch.name, "habit name is required");
    }
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

    this.h.run(
      `UPDATE habits SET name=?, icon=?, question=?, type=?, unit=?, target=?, target_direction=?,
                         frequency_type=?, frequency_days=?, frequency_count=?, routine_id=?,
                         sort_order=?, color=?, reminder_time=?, updated_at=?
       WHERE id=?`,
      [
        pick("name", cur.name), pick("icon", cur.icon), pick("question", cur.question),
        shape.type, shape.unit, shape.target, shape.targetDirection, shape.frequencyType,
        shape.frequencyDays ? JSON.stringify(shape.frequencyDays) : null, shape.frequencyCount,
        pick("routineId", cur.routineId), pick("sortOrder", cur.sortOrder),
        pick("color", cur.color), pick("reminderTime", cur.reminderTime), stamp(), id,
      ],
    );
    return this.getHabit(id);
  }

  /** Soft delete — hides the habit, keeps every entry. Reversible. */
  archiveHabit(id: string): void {
    this.getHabit(id);
    const ts = stamp();
    this.h.run(`UPDATE habits SET archived_at=?, updated_at=? WHERE id=?`, [ts, ts, id]);
  }

  unarchiveHabit(id: string): void {
    this.getHabit(id);
    this.h.run(`UPDATE habits SET archived_at=NULL, updated_at=? WHERE id=?`, [stamp(), id]);
  }

  /**
   * Permanent, cascades entries, and unreachable by a stray tap: the
   * confirmation flag is enforced at the API level (non-negotiable #7).
   */
  deleteHabit(id: string, opts: { confirmed?: boolean } = {}): void {
    this.getHabit(id);
    if (!opts.confirmed) throw new ConfirmationRequiredError("deleteHabit");
    this.h.run(`DELETE FROM habits WHERE id=?`, [id]);
  }

  reorderHabits(orderedIds: string[]): void {
    this.assertAllExist("habits", "habit", orderedIds);
    const ts = stamp();
    this.db.transaction((tx) => {
      const h = helpers(tx);
      orderedIds.forEach((id, i) => h.run(`UPDATE habits SET sort_order=?, updated_at=? WHERE id=?`, [i, ts, id]));
    });
  }

  private assertAllExist(table: "habits" | "routines", entity: string, ids: string[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(",");
    const found = new Set(
      this.h.rows(`SELECT id FROM ${table} WHERE id IN (${placeholders})`, ids).map((r) => String(r.id)),
    );
    const missing = ids.find((id) => !found.has(id));
    if (missing) throw new NotFoundError(entity, missing);
  }

  // ── Entries ─────────────────────────────────────────────────────────
  getEntry(habitId: string, date: string): Entry | null {
    const rows = this.h.rows(`SELECT * FROM entries WHERE habit_id=? AND date=?`, [habitId, date]);
    return rows.length ? toEntry(rows[0]) : null;
  }

  getEntriesForHabit(habitId: string, startDate: string, endDate: string): Entry[] {
    return this.h.rows(
      `SELECT * FROM entries WHERE habit_id=? AND date>=? AND date<=? ORDER BY date`,
      [habitId, startDate, endDate],
    ).map(toEntry);
  }

  getEntriesForDate(date: string): Entry[] {
    return this.h.rows(`SELECT * FROM entries WHERE date=? ORDER BY habit_id`, [date]).map(toEntry);
  }

  /** One statement regardless of habit count — the list view depends on this. */
  getEntriesForHabits(habitIds: string[], startDate: string, endDate: string): Entry[] {
    if (!habitIds.length) return [];
    const placeholders = habitIds.map(() => "?").join(",");
    return this.h.rows(
      `SELECT * FROM entries WHERE habit_id IN (${placeholders}) AND date>=? AND date<=?
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
    if (!DATE_RE.test(date)) throw new ValidationError("date", date, "must be a YYYY-MM-DD local calendar date");
    if (typeof value !== "number" || Number.isNaN(value)) throw new ValidationError("value", value, "must be a number");
    const ts = stamp();
    this.h.run(
      `INSERT INTO entries(id,habit_id,date,value,note,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(habit_id,date) DO UPDATE
         SET value=excluded.value, note=excluded.note, updated_at=excluded.updated_at`,
      [uuid(), habitId, date, value, note, ts, ts],
    );
    return this.getEntry(habitId, date) as Entry;
  }

  deleteEntry(habitId: string, date: string): void {
    this.h.run(`DELETE FROM entries WHERE habit_id=? AND date=?`, [habitId, date]);
  }

  getFirstEntryDate(habitId: string): string | null {
    const v = this.h.one(`SELECT MIN(date) FROM entries WHERE habit_id=?`, [habitId]);
    return v == null ? null : String(v);
  }

  getEntryCount(habitId: string): number {
    return Number(this.h.one(`SELECT COUNT(*) FROM entries WHERE habit_id=?`, [habitId]));
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

  // ── Test-only seams ─────────────────────────────────────────────────
  __dumpEntries(): Entry[] {
    return this.h.rows(`SELECT * FROM entries ORDER BY habit_id, date`).map(toEntry);
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

/**
 * Converts a raw sqlite3 failure into a typed error. Explicit checks
 * above catch most bad input first; this is the net for anything only the
 * schema knows (UNIQUE, FK, CHECK), so callers never see an untyped
 * SQLite exception.
 */
export function translateSqlError(err: unknown): never {
  const e = err as { resultCode?: number; message?: string };
  if (typeof e?.resultCode === "number" && (e.resultCode & 0xff) === SQLITE_CONSTRAINT) {
    throw new ConstraintError("sqlite", e.message || "constraint violation");
  }
  throw err as Error;
}
