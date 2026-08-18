// Layer 2b §5 / handoff B1. validateImport must decide whether a file is
// usable without touching the database, so it is testable as a pure
// function — which is the point of putting it in Layer 2.
import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, validateImport } from "../../src/logic/backup.js";

const CURRENT = 2;

/** A minimal file that should pass, so each test can spoil one thing. */
function goodFile(over: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT,
    exportedAt: "2026-08-16T09:00:00.000Z",
    routines: [{ id: "r1", name: "Morning", created_at: "x", updated_at: "x" }],
    habits: [{
      id: "h1", name: "Meditate", type: "boolean", frequency_type: "daily",
      target_direction: "at_least", routine_id: "r1", created_at: "x", updated_at: "x",
    }],
    entries: [{ id: "e1", habit_id: "h1", date: "2026-08-15", value: 1, created_at: "x", updated_at: "x" }],
    meta: [{ key: "day_start_hour", value: "4" }],
    ...over,
  };
}

const messages = (r: ReturnType<typeof validateImport>) => r.errors.map((e) => `${e.at}: ${e.message}`).join(" | ");

describe("validateImport — a good file", () => {
  it("accepts it and counts what is inside", () => {
    const r = validateImport(goodFile(), CURRENT);
    expect(r.ok, messages(r)).toBe(true);
    expect(r.counts).toEqual({ routines: 1, habits: 1, entries: 1 });
    expect(r.exportedAt).toBe("2026-08-16T09:00:00.000Z");
  });

  it("accepts a file from an older schema — migrations bring it forward", () => {
    expect(validateImport(goodFile({ schemaVersion: 1 }), CURRENT).ok).toBe(true);
  });
});

describe("validateImport — files that must be refused", () => {
  it("refuses something that is not an object at all", () => {
    for (const junk of [null, 42, "hello", []]) {
      expect(validateImport(junk, CURRENT).ok, JSON.stringify(junk)).toBe(false);
    }
  });

  it("refuses an unknown format", () => {
    const r = validateImport(goodFile({ format: 99 }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/format/i);
  });

  it("refuses a file from a NEWER schema, naming both versions", () => {
    // Importing it would silently drop columns this build cannot see.
    const r = validateImport(goodFile({ schemaVersion: CURRENT + 1 }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain(String(CURRENT + 1));
    expect(messages(r)).toContain(String(CURRENT));
  });

  it("refuses a file with no schema version", () => {
    const f = goodFile();
    delete (f as Record<string, unknown>).schemaVersion;
    expect(validateImport(f, CURRENT).ok).toBe(false);
  });

  it("refuses a missing table", () => {
    const f = goodFile();
    delete (f as Record<string, unknown>).entries;
    const r = validateImport(f, CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/entries/);
  });

  it("refuses an entry pointing at a habit the file does not contain", () => {
    // This would fail the foreign key mid-import; caught here, it can be
    // named instead of thrown.
    const r = validateImport(goodFile({
      entries: [{ id: "e1", habit_id: "ghost", date: "2026-08-15", value: 1 }],
    }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain("ghost");
  });

  it("refuses a habit pointing at a routine the file does not contain", () => {
    const r = validateImport(goodFile({
      habits: [{ id: "h1", name: "X", type: "boolean", frequency_type: "daily", routine_id: "ghost" }],
    }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain("ghost");
  });

  it("refuses two entries for the same habit-day, naming the date", () => {
    const r = validateImport(goodFile({
      entries: [
        { id: "e1", habit_id: "h1", date: "2026-08-15", value: 1 },
        { id: "e2", habit_id: "h1", date: "2026-08-15", value: 0 },
      ],
    }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain("2026-08-15");
  });

  it("refuses an impossible date", () => {
    const r = validateImport(goodFile({
      entries: [{ id: "e1", habit_id: "h1", date: "2026-02-30", value: 1 }],
    }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain("2026-02-30");
  });

  it("refuses NaN, Infinity and negative values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const r = validateImport(goodFile({
        entries: [{ id: "e1", habit_id: "h1", date: "2026-08-15", value }],
      }), CURRENT);
      expect(r.ok, String(value)).toBe(false);
    }
  });

  it("refuses an unknown habit type or frequency", () => {
    expect(validateImport(goodFile({
      habits: [{ id: "h1", name: "X", type: "sometimes", frequency_type: "daily" }],
    }), CURRENT).ok).toBe(false);
    expect(validateImport(goodFile({
      habits: [{ id: "h1", name: "X", type: "boolean", frequency_type: "fortnightly" }],
    }), CURRENT).ok).toBe(false);
  });

  it("refuses a measurable habit with no target", () => {
    const r = validateImport(goodFile({
      habits: [{ id: "h1", name: "Water", type: "numeric", frequency_type: "daily" }],
    }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/target/i);
  });

  it("refuses duplicate ids", () => {
    const r = validateImport(goodFile({
      habits: [
        { id: "h1", name: "A", type: "boolean", frequency_type: "daily" },
        { id: "h1", name: "B", type: "boolean", frequency_type: "daily" },
      ],
      entries: [],
    }), CURRENT);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/duplicate/i);
  });

  it("reports every problem at once, not just the first", () => {
    const r = validateImport(goodFile({
      habits: [{ id: "h1", name: "", type: "nope", frequency_type: "never" }],
      entries: [{ id: "e1", habit_id: "h1", date: "bad", value: "lots" }],
    }), CURRENT);
    expect(r.errors.length).toBeGreaterThan(3);
  });
});

describe("validateImport — warnings, not refusals", () => {
  it("warns about an empty backup rather than refusing it", () => {
    const r = validateImport(goodFile({ routines: [], habits: [], entries: [] }), CURRENT);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/empty/i);
  });

  it("warns about malformed settings and carries on", () => {
    const r = validateImport(goodFile({ meta: "nonsense" }), CURRENT);
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
