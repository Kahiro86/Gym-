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
    });
  }
}
