import { describe, it, expect } from "vitest";
import { computeStreakWeeks } from "../../src/storage/streak.js";
import type { StoredSession } from "../../src/storage/types.js";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// A Monday 12:00 UTC.
const MONDAY_NOON = Date.UTC(2026, 7, 10, 12, 0, 0);

function sessionAt(ts: number): StoredSession {
  return { id: `s-${ts}`, sets: [], loggedAt: ts };
}

describe("computeStreakWeeks", () => {
  it("is zero with no sessions at all", () => {
    expect(computeStreakWeeks([], MONDAY_NOON)).toBe(0);
  });

  it("counts the current week if it already has a session", () => {
    const sessions = [sessionAt(MONDAY_NOON)];
    expect(computeStreakWeeks(sessions, MONDAY_NOON)).toBe(1);
  });

  it("grants a grace period for the current week if it has no session yet, without breaking the streak", () => {
    // trained last week, nothing yet this week
    const sessions = [sessionAt(MONDAY_NOON - WEEK)];
    expect(computeStreakWeeks(sessions, MONDAY_NOON)).toBe(1);
  });

  it("counts consecutive weeks correctly", () => {
    const sessions = [sessionAt(MONDAY_NOON), sessionAt(MONDAY_NOON - WEEK), sessionAt(MONDAY_NOON - 2 * WEEK)];
    expect(computeStreakWeeks(sessions, MONDAY_NOON)).toBe(3);
  });

  it("stops counting at the first gap week", () => {
    // trained this week and last week, but skipped the week before that
    const sessions = [sessionAt(MONDAY_NOON), sessionAt(MONDAY_NOON - WEEK), sessionAt(MONDAY_NOON - 3 * WEEK)];
    expect(computeStreakWeeks(sessions, MONDAY_NOON)).toBe(2);
  });

  it("is zero if the most recent session was more than one week ago (streak broken)", () => {
    const sessions = [sessionAt(MONDAY_NOON - 2 * WEEK)];
    expect(computeStreakWeeks(sessions, MONDAY_NOON)).toBe(0);
  });

  it("multiple sessions in the same week only count once", () => {
    const sessions = [sessionAt(MONDAY_NOON), sessionAt(MONDAY_NOON + DAY), sessionAt(MONDAY_NOON + 2 * DAY)];
    expect(computeStreakWeeks(sessions, MONDAY_NOON)).toBe(1);
  });
});
