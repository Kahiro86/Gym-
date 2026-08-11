import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  captureTzOffsetMinutes,
  localDayIndex,
  localDayStart,
  localWeekIndex,
  localWeekStart,
  isSameLocalDay,
  isSameLocalWeek,
} from "../../src/storage/time.js";

const UTC = 0;
const EST = 300; // UTC-5, tzOffsetMinutes convention: positive when behind UTC
const EDT = 240; // UTC-4 (daylight)
const JST = -540; // UTC+9
const MST = 420; // UTC-7

describe("time.ts", () => {
  describe("captureTzOffsetMinutes", () => {
    it("wraps Date#getTimezoneOffset and never throws with no argument", () => {
      expect(typeof captureTzOffsetMinutes()).toBe("number");
      expect(captureTzOffsetMinutes(0)).toBe(new Date(0).getTimezoneOffset());
    });
  });

  describe("localDayIndex", () => {
    it("1970-01-01T00:00:00Z is day 0 in UTC", () => {
      expect(localDayIndex(0, UTC)).toBe(0);
    });

    it("a millisecond before local midnight is still the previous day", () => {
      expect(localDayIndex(DAY_MS - 1, UTC)).toBe(0);
      expect(localDayIndex(DAY_MS, UTC)).toBe(1);
    });

    it("a set logged at 23:55 local, and one 10 minutes later, land on different local days", () => {
      const dayStart = localDayStart(50 * DAY_MS, EST);
      const at2355 = dayStart + 23 * 3600_000 + 55 * 60_000;
      const at0005NextDay = at2355 + 10 * 60_000;

      expect(localDayIndex(at2355, EST)).toBe(localDayIndex(dayStart, EST));
      expect(localDayIndex(at0005NextDay, EST)).toBe(localDayIndex(dayStart, EST) + 1);
      expect(isSameLocalDay(at2355, EST, at0005NextDay, EST)).toBe(false);
    });

    it("localDayStart round-trips through localDayIndex", () => {
      const t = 12345 * DAY_MS + 3600_000;
      const start = localDayStart(t, EST);
      expect(localDayIndex(start, EST)).toBe(localDayIndex(t, EST));
    });
  });

  describe("localWeekIndex (Monday start)", () => {
    it("matches the known 1970 calendar: Sun Jan 4 is week 0, Mon Jan 5 is week 1", () => {
      const sunJan4 = 3 * DAY_MS; // day index 3
      const monJan5 = 4 * DAY_MS; // day index 4
      expect(localWeekIndex(sunJan4, UTC)).toBe(0);
      expect(localWeekIndex(monJan5, UTC)).toBe(1);
    });

    it("Monday and the following Sunday are the same week; the next Monday is not", () => {
      const monJan5 = 4 * DAY_MS;
      const sunJan11 = 10 * DAY_MS;
      const monJan12 = 11 * DAY_MS;
      expect(isSameLocalWeek(monJan5, UTC, sunJan11, UTC)).toBe(true);
      expect(isSameLocalWeek(monJan5, UTC, monJan12, UTC)).toBe(false);
    });

    it("localWeekStart round-trips through localWeekIndex", () => {
      const t = 12345 * DAY_MS;
      const start = localWeekStart(t, EST);
      expect(localWeekIndex(start, EST)).toBe(localWeekIndex(t, EST));
    });
  });

  describe("relocation mid-week: each event uses its own captured offset", () => {
    it("the same instant can fall in different local weeks depending on which offset classifies it", () => {
      // A moment right at a week boundary in UTC — Tokyo (UTC+9) and Denver
      // (UTC-7) can disagree about which calendar week it's in.
      const nearBoundary = 4 * DAY_MS - 30 * 60_000; // 30 min before Monday 00:00 UTC
      const tokyoWeek = localWeekIndex(nearBoundary, JST);
      const denverWeek = localWeekIndex(nearBoundary, MST);
      expect(tokyoWeek).not.toBe(denverWeek);
    });

    it("a session's week grouping is fixed at its own captured offset, not recomputed after relocating", () => {
      const sessionEpoch = 4 * DAY_MS - 30 * 60_000;
      const capturedInTokyo = JST;
      const originalWeek = localWeekIndex(sessionEpoch, capturedInTokyo);

      // The user later relocates to Denver — recomputing the SAME session
      // against Denver's offset would silently reshuffle history, which is
      // exactly what capturing tzOffsetMinutes per-session prevents. The
      // repository must always pass the session's own stored offset, never
      // the device's current one.
      const recomputedWithCurrentOffset = localWeekIndex(sessionEpoch, MST);
      expect(recomputedWithCurrentOffset).not.toBe(originalWeek);
      expect(localWeekIndex(sessionEpoch, capturedInTokyo)).toBe(originalWeek);
    });
  });

  describe("DST transitions", () => {
    it("spring forward: a session just before and one just after the clock change still order correctly", () => {
      // Simulated 2am->3am spring-forward: same nominal local wall-clock
      // hour straddles the transition, captured with EST then EDT.
      const beforeTransition = 100 * DAY_MS; // some arbitrary UTC instant, captured as EST
      const afterTransition = beforeTransition + 3600_000; // captured as EDT an hour later in real time

      const dayBefore = localDayIndex(beforeTransition, EST);
      const dayAfter = localDayIndex(afterTransition, EDT);
      expect(dayAfter).toBeGreaterThanOrEqual(dayBefore);
    });

    it("fall back: a repeated local hour does not break day-index monotonicity in UTC terms", () => {
      const beforeTransition = 300 * DAY_MS; // captured as EDT
      const afterTransition = beforeTransition + 3600_000; // captured as EST an hour later in real time

      const dayBefore = localDayIndex(beforeTransition, EDT);
      const dayAfter = localDayIndex(afterTransition, EST);
      expect(dayAfter).toBeGreaterThanOrEqual(dayBefore);
    });
  });
});
