// Forward-only migrations. Never edit a shipped migration — add a new one.
// meta.schema_version tracks how far a database has been brought forward.

export interface Migration {
  version: number;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE routines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        question TEXT,
        type TEXT NOT NULL CHECK (type IN ('boolean','numeric')),
        unit TEXT,
        target REAL,
        target_direction TEXT NOT NULL DEFAULT 'at_least' CHECK (target_direction IN ('at_least','at_most')),
        frequency_type TEXT NOT NULL CHECK (frequency_type IN ('daily','specific_days','times_per_week','times_per_month')),
        frequency_days TEXT,
        frequency_count INTEGER,
        routine_id TEXT REFERENCES routines(id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        reminder_time TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        value REAL NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX ux_entries_habit_date ON entries(habit_id, date);
      CREATE INDEX ix_entries_date ON entries(date);
      CREATE INDEX ix_habits_routine_id ON habits(routine_id);
      CREATE INDEX ix_habits_archived_at ON habits(archived_at);

      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
];

// Minimal shape migrations need from the DB — kept narrow so this module
// doesn't depend on the sqlite3 package's types directly.
interface MigratableDb {
  selectValue(sql: string, bind?: unknown): unknown;
  exec(sql: string): unknown;
  transaction<T>(cb: (db: this) => T): T;
}

export function getSchemaVersion(db: MigratableDb): number {
  const hasMeta = db.selectValue("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='meta'");
  if (!hasMeta) return 0;
  const v = db.selectValue("SELECT value FROM meta WHERE key='schema_version'");
  return v ? parseInt(String(v), 10) : 0;
}

// Applies every migration above the database's current version, in order,
// each inside its own transaction. Also seeds the required meta keys
// (§4.6) the first time migration 1 runs. Running this against an
// up-to-date database is a no-op.
export function runMigrations(db: MigratableDb): void {
  db.exec("PRAGMA foreign_keys = ON;");
  const current = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.transaction((txDb) => {
      txDb.exec(m.up);
      txDb.exec(`INSERT INTO meta(key,value) VALUES ('schema_version','${m.version}')
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
      if (m.version === 1) {
        txDb.exec(`INSERT OR IGNORE INTO meta(key,value) VALUES ('day_start_hour','4');`);
      }
    });
  }
}
