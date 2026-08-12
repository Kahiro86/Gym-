import { describe, it, expect } from "vitest";
import { formatRelativeDay } from "../../src/app/formatRelativeDay.js";

const NOON = new Date(2026, 0, 15, 12, 0, 0).getTime(); // 2026-01-15 noon, local
const DAY_MS = 24 * 60 * 60 * 1000;

describe("formatRelativeDay", () => {
  it("labels the same calendar day as Today, even earlier that day", () => {
    expect(formatRelativeDay(NOON - 6 * 60 * 60 * 1000, NOON)).toBe("Today");
  });

  it("labels the previous calendar day as Yesterday", () => {
    expect(formatRelativeDay(NOON - DAY_MS, NOON)).toBe("Yesterday");
  });

  it("labels 2-6 days back as 'N days ago'", () => {
    expect(formatRelativeDay(NOON - 3 * DAY_MS, NOON)).toBe("3 days ago");
  });

  it("falls back to a short date at a week or more back", () => {
    const result = formatRelativeDay(NOON - 10 * DAY_MS, NOON);
    expect(result).not.toMatch(/ago|Today|Yesterday/);
  });
});
