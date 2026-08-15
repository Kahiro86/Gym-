// Forward-only migrations (spec Layer 1 §7). Never edit a shipped
// migration — add a new one. meta.schema_version records how far a given
// database has been brought forward.

export interface Migration {
  version: number;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE routines (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        icon        TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE habits (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        icon             TEXT,
        question         TEXT,
        type             TEXT NOT NULL CHECK (type IN ('boolean','numeric')),
        unit             TEXT,
        target           REAL,
        target_direction TEXT NOT NULL DEFAULT 'at_least' CHECK (target_direction IN ('at_least','at_most')),
        frequency_type   TEXT NOT NULL CHECK (frequency_type IN ('daily','specific_days','times_per_week','times_per_month')),
        frequency_days   TEXT,
        frequency_count  INTEGER,
        routine_id       TEXT REFERENCES routines(id),
        sort_order       INTEGER NOT NULL DEFAULT 0,
        color            TEXT,
        reminder_time    TEXT,
        archived_at      TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE entries (
        id         TEXT PRIMARY KEY,
        habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        date       TEXT NOT NULL,
        value      REAL NOT NULL,
        note       TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The constraint that makes duplicate-day rows structurally
      -- impossible, and the index that serves the primary lookup.
      CREATE UNIQUE INDEX ux_entries_habit_date ON entries(habit_id, date);
      CREATE INDEX ix_entries_date       ON entries(date);
      CREATE INDEX ix_habits_routine_id  ON habits(routine_id);
      CREATE INDEX ix_habits_archived_at ON habits(archived_at);

      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
  {
    // Layer 1b §4 — the columns and the queue that make sync possible.
    // Nothing here changes what Layer 1 means; it adds bookkeeping
    // alongside it.
    version: 2,
    up: `
      -- user_id is nullable locally and NOT NULL in Postgres. There is no
      -- session before first sign-in, and inventing a placeholder id would
      -- be fabricating data; the value is stamped when a session exists.
      ALTER TABLE routines ADD COLUMN user_id TEXT;
      ALTER TABLE habits   ADD COLUMN user_id TEXT;
      ALTER TABLE entries  ADD COLUMN user_id TEXT;

      -- Tombstones (§6). "No row" is ambiguous once two devices are
      -- involved: it could mean never logged, or deleted elsewhere and
      -- not yet heard about. A tombstone says which.
      ALTER TABLE routines ADD COLUMN deleted_at TEXT;
      ALTER TABLE habits   ADD COLUMN deleted_at TEXT;
      ALTER TABLE entries  ADD COLUMN deleted_at TEXT;

      -- Local-only. Never pushed, never shown to Layer 2.
      ALTER TABLE routines ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE habits   ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE entries  ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';

      -- Every read filters on deleted_at, so it earns an index.
      CREATE INDEX ix_routines_deleted_at ON routines(deleted_at);
      CREATE INDEX ix_habits_deleted_at   ON habits(deleted_at);
      CREATE INDEX ix_entries_deleted_at  ON entries(deleted_at);

      -- A normal table in the same database as the data it describes,
      -- which is the whole point: a mutation and its queue row are
      -- written in one transaction and cannot drift apart.
      CREATE TABLE sync_queue (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL CHECK (table_name IN ('habits','routines','entries')),
        record_id  TEXT NOT NULL,
        operation  TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
        payload    TEXT NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX ix_sync_queue_record ON sync_queue(table_name, record_id);

      -- Rows that already existed have never been pushed. Without this
      -- they would sit at 'pending' with nothing queued to make them
      -- otherwise, and a user's whole history would quietly never reach
      -- the server. Columns are listed rather than globbed so that adding
      -- one later forces a decision about whether it syncs.
      INSERT INTO sync_queue(table_name, record_id, operation, payload, created_at)
      SELECT 'routines', id, 'upsert', json_object(
        'id', id, 'name', name, 'icon', icon, 'sort_order', sort_order,
        'archived_at', archived_at, 'created_at', created_at, 'updated_at', updated_at,
        'user_id', user_id, 'deleted_at', deleted_at
      ), updated_at FROM routines;

      INSERT INTO sync_queue(table_name, record_id, operation, payload, created_at)
      SELECT 'habits', id, 'upsert', json_object(
        'id', id, 'name', name, 'icon', icon, 'question', question, 'type', type,
        'unit', unit, 'target', target, 'target_direction', target_direction,
        'frequency_type', frequency_type, 'frequency_days', frequency_days,
        'frequency_count', frequency_count, 'routine_id', routine_id,
        'sort_order', sort_order, 'color', color, 'reminder_time', reminder_time,
        'archived_at', archived_at, 'created_at', created_at, 'updated_at', updated_at,
        'user_id', user_id, 'deleted_at', deleted_at
      ), updated_at FROM habits;

      INSERT INTO sync_queue(table_name, record_id, operation, payload, created_at)
      SELECT 'entries', id, 'upsert', json_object(
        'id', id, 'habit_id', habit_id, 'date', date, 'value', value, 'note', note,
        'created_at', created_at, 'updated_at', updated_at,
        'user_id', user_id, 'deleted_at', deleted_at
      ), updated_at FROM entries;
    `,
  },
];

/** The slice of the sqlite3 handle migrations need. */
interface MigratableDb {
  exec(sql: string): unknown;
  selectValue(sql: string): unknown;
  transaction<T>(cb: (db: MigratableDb) => T): T;
}

export function getSchemaVersion(db: MigratableDb): number {
  const hasMeta = db.selectValue("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='meta'");
  if (!hasMeta) return 0;
  const v = db.selectValue("SELECT value FROM meta WHERE key='schema_version'");
  return v == null ? 0 : parseInt(String(v), 10);
}

/**
 * Applies every migration above the database's current version, in order,
 * each inside a transaction, and seeds the required meta keys on first
 * run (spec §4.6). Idempotent: re-running against an up-to-date database
 * does nothing.
 */
export function runMigrations(db: MigratableDb): void {
  // SQLite does not enforce foreign keys unless asked, on every
  // connection (spec §6.6). Forgetting this is a silent correctness bug.
  db.exec("PRAGMA foreign_keys = ON;");
  const current = getSchemaVersion(db);
  for (const m of MIGRATIONS.filter((x) => x.version > current).sort((a, b) => a.version - b.version)) {
    db.transaction((tx) => {
      tx.exec(m.up);
      tx.exec(
        `INSERT INTO meta(key,value) VALUES ('schema_version','${m.version}')
           ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
      );
      if (m.version === 1) {
        tx.exec(`INSERT OR IGNORE INTO meta(key,value) VALUES ('day_start_hour','4');`);
      }
      if (m.version === 2) {
        // §4.3. device_id is generated rather than written as a literal
        // because a migration string is the same on every device and an
        // identifier that is not unique is worse than none.
        tx.exec(
          `INSERT OR IGNORE INTO meta(key,value) VALUES ('device_id','${crypto.randomUUID()}');`,
        );
        // last_pull_at is deliberately absent rather than seeded empty:
        // "never pulled" and "pulled, found nothing" are different, and
        // an empty string would blur them.
      }
    });
  }
}
