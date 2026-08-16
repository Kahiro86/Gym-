// Layer 1's date validation. Spec §9.10: every case here has bitten a
// shipped habit app, and a regex alone catches none of them.
import { describe, expect, it } from "vitest";
import { assertDateString, isValidDateString } from "../../src/db/dates.js";

const ok = (d: string) => isValidDateString(d);

describe("isValidDateString — shape", () => {
  it("accepts a well-formed date", () => {
    expect(ok("2026-08-15")).toBe(true);
  });

  it("requires zero padding", () => {
    // "2026-8-1" sorts before "2026-10-01" but after "2026-1-01", which
    // silently breaks the lexicographic ordering the schema relies on.
    expect(ok("2026-8-1")).toBe(false);
    expect(ok("2026-08-1")).toBe(false);
    expect(ok("2026-8-01")).toBe(false);
  });

  it("rejects other separators and orders", () => {
    for (const d of ["08/01/2026", "2026/08/01", "2026.08.01", "20260801", "01-08-2026"]) {
      expect(ok(d), d).toBe(false);
    }
  });

  it("rejects an empty string and whitespace", () => {
    for (const d of ["", " ", "\n", "  2026-08-15  "]) expect(ok(d), JSON.stringify(d)).toBe(false);
  });

  it("rejects a timestamp, which is the exact confusion the schema forbids", () => {
    expect(ok("2026-08-15T00:00:00.000Z")).toBe(false);
    expect(ok("2026-08-15 12:00")).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const v of [null, undefined, 20260815, new Date(), {}, []]) {
      expect(isValidDateString(v as unknown), String(v)).toBe(false);
    }
  });
});

describe("isValidDateString — real calendar days", () => {
  it("rejects month 00 and month 13", () => {
    expect(ok("2026-00-10")).toBe(false);
    expect(ok("2026-13-01")).toBe(false);
  });

  it("rejects day 00 and day 32", () => {
    expect(ok("2026-01-00")).toBe(false);
    expect(ok("2026-01-32")).toBe(false);
  });

  it("rejects the 31st of a 30-day month", () => {
    for (const d of ["2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31"]) {
      expect(ok(d), d).toBe(false);
    }
  });

  it("accepts the 31st of every 31-day month", () => {
    for (const m of ["01", "03", "05", "07", "08", "10", "12"]) {
      expect(ok(`2026-${m}-31`), m).toBe(true);
    }
  });

  it("rejects 30 February in any year", () => {
    expect(ok("2026-02-30")).toBe(false);
    expect(ok("2028-02-30")).toBe(false);
  });

  it("accepts 29 February in a leap year", () => {
    for (const y of ["2024", "2028", "2032"]) expect(ok(`${y}-02-29`), y).toBe(true);
  });

  it("rejects 29 February in a common year", () => {
    for (const y of ["2025", "2026", "2027"]) expect(ok(`${y}-02-29`), y).toBe(false);
  });

  it("applies the century rule, not the divisible-by-four shorthand", () => {
    // 1900 and 2100 are divisible by 4 and are NOT leap years; 2000 is,
    // because of the 400 rule. Getting this wrong is invisible until it
    // is not.
    expect(ok("1900-02-29")).toBe(false);
    expect(ok("2100-02-29")).toBe(false);
    expect(ok("2000-02-29")).toBe(true);
    expect(ok("2400-02-29")).toBe(true);
  });
});

describe("isValidDateString — bounds", () => {
  it("is deliberately unbounded in either direction", () => {
    expect(ok("1970-01-01")).toBe(true);
    expect(ok("1900-01-01")).toBe(true);
    expect(ok("2099-12-31")).toBe(true);
    expect(ok("9999-12-31")).toBe(true);
  });

  it("keeps lexicographic order chronological across those bounds", () => {
    const dates = ["2099-12-31", "1970-01-01", "2026-08-15", "1900-01-01", "2000-02-29"];
    expect([...dates].sort()).toEqual([
      "1900-01-01", "1970-01-01", "2000-02-29", "2026-08-15", "2099-12-31",
    ]);
  });
});

describe("assertDateString", () => {
  it("returns the value unchanged when it is valid", () => {
    expect(assertDateString("date", "2026-08-15")).toBe("2026-08-15");
  });

  it("throws a ValidationError naming the field and the value", () => {
    let err: Error | null = null;
    try { assertDateString("startDate", "2026-02-30"); } catch (e) { err = e as Error; }
    expect(err?.name).toBe("ValidationError");
    // Spec §8: "invalid input" is not an acceptable message.
    expect(err?.message).toContain("startDate");
    expect(err?.message).toContain("2026-02-30");
  });
});
