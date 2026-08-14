import { describe, it, expect } from "vitest";
import {
  addDays, daysBetween, dateRange, dayOfWeek, weekStart, monthOf,
  daysInMonth, firstOfMonth, lastOfMonth, shiftMonth, clamp, instantToDateStr,
} from "../../src/logic/dates.js";

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    // 2026 is not a leap year
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("daysBetween", () => {
  it("counts forward, backward, and zero", () => {
    expect(daysBetween("2026-08-01", "2026-08-08")).toBe(7);
    expect(daysBetween("2026-08-08", "2026-08-01")).toBe(-7);
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  });

  it("counts correctly across a year boundary", () => {
    expect(daysBetween("2025-12-29", "2026-01-04")).toBe(6);
  });
});

describe("dateRange", () => {
  it("is inclusive at both ends", () => {
    expect(dateRange("2026-08-01", "2026-08-03")).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("returns a single day when start equals end", () => {
    expect(dateRange("2026-08-01", "2026-08-01")).toEqual(["2026-08-01"]);
  });

  it("returns empty when start is after end rather than throwing", () => {
    expect(dateRange("2026-08-05", "2026-08-01")).toEqual([]);
  });

  it("spans a month boundary with the right count", () => {
    expect(dateRange("2026-07-28", "2026-08-03")).toHaveLength(7);
  });

  it("sorts lexicographically across a year boundary", () => {
    const r = dateRange("2025-12-30", "2026-01-02");
    expect(r).toEqual([...r].sort());
  });
});

describe("dayOfWeek / weekStart", () => {
  it("uses 0=Sunday", () => {
    // 2026-08-16 is a Sunday; 2026-08-14 is a Friday.
    expect(dayOfWeek("2026-08-16")).toBe(0);
    expect(dayOfWeek("2026-08-14")).toBe(5);
  });

  it("anchors weeks on Sunday", () => {
    expect(weekStart("2026-08-14")).toBe("2026-08-09");
    expect(weekStart("2026-08-09")).toBe("2026-08-09");
  });
});

describe("month helpers", () => {
  it("reports month length including leap years", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-08")).toBe(31);
    expect(daysInMonth("2026-04")).toBe(30);
  });

  it("gives first and last of month", () => {
    expect(firstOfMonth("2026-08")).toBe("2026-08-01");
    expect(lastOfMonth("2026-02")).toBe("2026-02-28");
  });

  it("shifts months across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-08", -12)).toBe("2025-08");
  });

  it("extracts YYYY-MM", () => {
    expect(monthOf("2026-08-14")).toBe("2026-08");
  });
});

describe("clamp", () => {
  it("bounds a date on both sides and passes through in-range values", () => {
    expect(clamp("2026-08-01", "2026-08-05", "2026-08-10")).toBe("2026-08-05");
    expect(clamp("2026-08-20", "2026-08-05", "2026-08-10")).toBe("2026-08-10");
    expect(clamp("2026-08-07", "2026-08-05", "2026-08-10")).toBe("2026-08-07");
  });
});

describe("instantToDateStr", () => {
  it("returns the LOCAL calendar date of a stored timestamp", () => {
    // Built from local components, so this holds in any timezone.
    const local = new Date(2026, 7, 14, 12, 0, 0);
    expect(instantToDateStr(local.toISOString())).toBe("2026-08-14");
  });

  it("does not shift the date for a late-evening local timestamp", () => {
    const lateLocal = new Date(2026, 7, 14, 23, 50, 0);
    expect(instantToDateStr(lateLocal.toISOString())).toBe("2026-08-14");
  });
});
