// translateSqlError turns a raw sqlite3 failure into something the UI can
// act on. Spec §8: no method may surface an untyped exception, and §9.12
// test 58: a quota failure must be typed, never swallowed.
import { describe, expect, it } from "vitest";
import { translateSqlError } from "../../src/db/repository.js";

/** Shaped like the errors sqlite3-wasm actually throws. */
const sqliteError = (resultCode: number, message: string) =>
  Object.assign(new Error(message), { resultCode });

function thrownBy(fn: () => never): Error {
  try { fn(); } catch (e) { return e as Error; }
  throw new Error("nothing was thrown");
}

describe("translateSqlError", () => {
  it("maps a constraint violation to ConstraintError", () => {
    // 2067 is SQLITE_CONSTRAINT_UNIQUE: the extended code, whose low
    // byte is SQLITE_CONSTRAINT. Matching only the bare 19 would miss
    // every real violation.
    const err = thrownBy(() => translateSqlError(sqliteError(2067, "UNIQUE constraint failed: entries.habit_id, entries.date")));
    expect(err.name).toBe("ConstraintError");
    expect(err.message).toContain("UNIQUE constraint failed");
  });

  it("maps a foreign-key violation to ConstraintError too", () => {
    const err = thrownBy(() => translateSqlError(sqliteError(787, "FOREIGN KEY constraint failed")));
    expect(err.name).toBe("ConstraintError");
  });

  it("maps SQLITE_FULL to QuotaExceededError", () => {
    const err = thrownBy(() => translateSqlError(sqliteError(13, "database or disk is full")));
    expect(err.name).toBe("QuotaExceededError");
    expect(err.message).toMatch(/storage is full/i);
  });

  it("maps the browser's own QuotaExceededError, which arrives by name", () => {
    const err = thrownBy(() => translateSqlError(Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" })));
    expect(err.name).toBe("QuotaExceededError");
  });

  it("maps an I/O error that mentions quota — how OPFS surfaces it", () => {
    const err = thrownBy(() => translateSqlError(sqliteError(3338, "disk I/O error: QuotaExceededError")));
    expect(err.name).toBe("QuotaExceededError");
  });

  it("maps a bare 'no space left on device'", () => {
    const err = thrownBy(() => translateSqlError(new Error("write failed: no space left on device")));
    expect(err.name).toBe("QuotaExceededError");
  });

  it("rethrows anything it does not recognise, rather than mislabelling it", () => {
    // Guessing at an unfamiliar failure would hide it behind a wrong
    // name, which is worse than an unfamiliar name.
    const original = sqliteError(1, "no such table: habits");
    const err = thrownBy(() => translateSqlError(original));
    expect(err).toBe(original);
  });

  it("does not mistake a constraint message for a quota failure", () => {
    const err = thrownBy(() => translateSqlError(sqliteError(2067, "UNIQUE constraint failed")));
    expect(err.name).toBe("ConstraintError");
  });
});
