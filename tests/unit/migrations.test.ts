// The migration runner, against an in-memory stand-in for the sqlite3
// handle. Spec §9.11: a migration failure on someone's only copy of
// their data is unrecoverable, so the rollback has to be observed rather
// than assumed from the presence of a transaction() call.
import { describe, expect, it } from "vitest";
import { LATEST_VERSION, MIGRATIONS, getSchemaVersion, runMigrations } from "../../src/db/migrations.js";

/**
 * Records every statement and honours transaction boundaries: on a throw
 * inside the callback, every statement since BEGIN is discarded. That is
 * exactly the property under test, so it is modelled rather than mocked
 * away.
 */
function fakeDb(initial: { version?: number | null } = {}) {
  let applied: string[] = [];
  let meta: Record<string, string> = {};
  if (initial.version != null) meta.schema_version = String(initial.version);

  const db = {
    applied: () => applied,
    meta: () => ({ ...meta }),
    exec(sql: string) {
      applied.push(sql.trim().slice(0, 60));
      // The runner writes schema_version through a literal INSERT.
      const m = /INSERT INTO meta\(key,value\) VALUES \('([^']+)','([^']*)'\)/.exec(sql);
      if (m) meta[m[1]] = m[2];
      const ig = /INSERT OR IGNORE INTO meta\(key,value\) VALUES \('([^']+)','([^']*)'\)/.exec(sql);
      if (ig && !(ig[1] in meta)) meta[ig[1]] = ig[2];
      if (/^THROW/.test(sql.trim())) throw new Error("migration exploded");
      return undefined;
    },
    selectValue(sql: string) {
      if (/sqlite_master/.test(sql)) return initial.version != null ? 1 : 0;
      if (/key='schema_version'/.test(sql)) return meta.schema_version ?? null;
      return null;
    },
    transaction<T>(cb: (d: typeof db) => T): T {
      const savedApplied = [...applied];
      const savedMeta = { ...meta };
      try {
        return cb(db);
      } catch (err) {
        applied = savedApplied;
        meta = savedMeta;
        throw err;
      }
    },
  };
  return db;
}

describe("the shipped migration list", () => {
  it("is numbered from 1 with no gaps and no duplicates", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });

  it("LATEST_VERSION is the highest shipped migration", () => {
    expect(LATEST_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
  });

  it("turns foreign keys on before anything else", () => {
    const db = fakeDb();
    runMigrations(db);
    expect(db.applied()[0]).toMatch(/PRAGMA foreign_keys = ON/);
  });
});

describe("runMigrations", () => {
  it("takes an empty database to the latest version", () => {
    const db = fakeDb();
    runMigrations(db);
    expect(db.meta().schema_version).toBe(String(LATEST_VERSION));
  });

  it("seeds day_start_hour and a device id on first run", () => {
    const db = fakeDb();
    runMigrations(db);
    expect(db.meta().day_start_hour).toBe("4");
    expect(db.meta().device_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("leaves last_pull_at unset, so 'never pulled' stays distinguishable", () => {
    const db = fakeDb();
    runMigrations(db);
    expect(db.meta().last_pull_at).toBeUndefined();
  });

  it("is a no-op when the database is already current", () => {
    const db = fakeDb({ version: LATEST_VERSION });
    runMigrations(db);
    // Only the pragma; no migration bodies.
    expect(db.applied()).toEqual([expect.stringMatching(/PRAGMA foreign_keys/)]);
  });

  it("applies only the migrations above the current version", () => {
    const db = fakeDb({ version: 1 });
    runMigrations(db);
    // Migration 2 ran (it is the only one above version 1)...
    expect(db.meta().schema_version).toBe(String(LATEST_VERSION));
    expect(db.applied().length).toBeGreaterThan(1);
    // ...and migration 1 did not, which would have re-created the tables.
    expect(db.applied().some((x) => /CREATE TABLE routines/.test(x))).toBe(false);
  });

  // ── §9.11 test 54 ──────────────────────────────────────────────────
  it("54. migration_is_transactional — a throw leaves version and schema untouched", () => {
    const db = fakeDb();
    const broken = [{ version: 1, up: "CREATE TABLE ok (a);" }, { version: 2, up: "THROW" }];
    // The runner is exercised through its own loop by temporarily
    // standing in a broken list, rather than shipping a failing
    // migration to prove a point.
    const original = MIGRATIONS.splice(0, MIGRATIONS.length, ...broken);
    try {
      expect(() => runMigrations(db)).toThrow(/exploded/);
      // Migration 1 committed; migration 2 rolled back completely.
      expect(db.meta().schema_version).toBe("1");
      expect(db.applied().some((s) => /THROW/.test(s))).toBe(false);
    } finally {
      MIGRATIONS.splice(0, MIGRATIONS.length, ...original);
    }
  });

  // ── §9.11 test 56 ──────────────────────────────────────────────────
  it("56. refuses_downgrade — a newer database will not open", () => {
    const db = fakeDb({ version: LATEST_VERSION + 1 });
    expect(() => runMigrations(db)).toThrow(/older than your data/i);
  });

  it("the downgrade message names both versions, so the user can act on it", () => {
    const db = fakeDb({ version: 99 });
    expect(() => runMigrations(db)).toThrow(new RegExp(`version 99.*understands ${LATEST_VERSION}`));
  });

  it("opens normally at exactly the latest version", () => {
    expect(() => runMigrations(fakeDb({ version: LATEST_VERSION }))).not.toThrow();
  });
});

describe("getSchemaVersion", () => {
  it("reports 0 for a database with no meta table", () => {
    expect(getSchemaVersion(fakeDb())).toBe(0);
  });

  it("reports the stored version once meta exists", () => {
    expect(getSchemaVersion(fakeDb({ version: 2 }))).toBe(2);
  });
});
