import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGymStore } from "../../src/storage/inMemoryStore.js";
import { logSession, deleteSession } from "../../src/storage/session.js";
import { levelFromTotalXp } from "../../src/domain/progression.js";
import type { LoggedSet } from "../../src/domain/types.js";

const BW = 80;
const DAY = 86_400_000;
const MONDAY_NOON = Date.UTC(2026, 7, 10, 12, 0, 0);

function pushupSets(reps: number, timestamp: number): LoggedSet[] {
  return [{ exerciseId: "pushup", reps, bodyweightKg: BW, timestamp }];
}

describe("logSession", () => {
  let store: InMemoryGymStore;
  beforeEach(() => {
    store = new InMemoryGymStore();
  });

  it("returns an XP breakdown and updates the store's derived state", () => {
    const result = logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });

    expect(result.sessionId).toBe("s1");
    expect(result.xp.total).toBeGreaterThan(0);
    expect(Object.keys(store.getExerciseHistory())).toContain("pushup");
    expect(store.getBodyweightHistory()).toEqual({ maxBodyweightKg: BW, minBodyweightKg: BW });
  });

  it("accumulates cumulative stats across sessions", () => {
    logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });
    logSession(store, { id: "s2", sets: pushupSets(15, MONDAY_NOON + DAY), loggedAt: MONDAY_NOON + DAY });

    const stats = store.getCumulativeStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalSets).toBe(2);
    expect(stats.totalVolume).toBeGreaterThan(0);
    expect(stats.muscleXp.chestSternal).toBeGreaterThan(0);
  });

  it("chains PR detection across sessions (not just within one)", () => {
    const first = logSession(store, {
      id: "s1",
      sets: [{ exerciseId: "barbell-bench-press", weightKg: 60, reps: 8, bodyweightKg: BW, timestamp: MONDAY_NOON }],
      loggedAt: MONDAY_NOON,
    });
    // first-ever log of this exercise -> discovery bonus, not exercise PRs
    // (a bodyweightMax PR still fires — first-ever bodyweight log too)
    expect(first.xp.prs.some((p) => p.exerciseId === "barbell-bench-press")).toBe(false);

    const second = logSession(store, {
      id: "s2",
      sets: [{ exerciseId: "barbell-bench-press", weightKg: 70, reps: 8, bodyweightKg: BW, timestamp: MONDAY_NOON + DAY }],
      loggedAt: MONDAY_NOON + DAY,
    });
    expect(second.xp.prs.some((p) => p.type === "weight")).toBe(true);
  });

  it("only the first session of a calendar day gets the session-first bonus", () => {
    const first = logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });
    const second = logSession(store, { id: "s2", sets: pushupSets(15, MONDAY_NOON + 3600_000), loggedAt: MONDAY_NOON + 3600_000 });

    expect(first.xp.setBreakdowns[0]!.components.some((c) => c.label === "session first")).toBe(true);
    expect(second.xp.setBreakdowns[0]!.components.some((c) => c.label === "session first")).toBe(false);
  });

  it("unlocks achievements automatically and folds their reward XP into cumulative totalXp", () => {
    const result = logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });

    expect(result.unlockedAchievements.some((u) => u.achievementId === "first-session")).toBe(true);
    // cumulative totalXp includes the achievement's reward XP, not just the raw session XP
    expect(store.getCumulativeStats().totalXp).toBeGreaterThan(result.xp.total);
  });

  it("never re-unlocks the same achievement on a later session", () => {
    logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });
    const second = logSession(store, { id: "s2", sets: pushupSets(15, MONDAY_NOON + DAY), loggedAt: MONDAY_NOON + DAY });

    expect(second.unlockedAchievements.some((u) => u.achievementId === "first-session")).toBe(false);
  });

  it("reports leveledUp only on the session that actually crosses a level boundary", () => {
    const result = logSession(store, { id: "s1", sets: pushupSets(50, MONDAY_NOON), loggedAt: MONDAY_NOON });
    const expectedLevel = levelFromTotalXp(store.getCumulativeStats().totalXp).level;
    expect(result.level).toBe(expectedLevel);
    if (expectedLevel > 1) {
      expect(result.leveledUp).toBe(true);
    }
  });

  it("editing a session (same id, upsert) recomputes derived state instead of double-counting", () => {
    logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });
    const statsBeforeEdit = store.getCumulativeStats();
    expect(statsBeforeEdit.totalSessions).toBe(1);

    logSession(store, { id: "s1", sets: pushupSets(30, MONDAY_NOON), loggedAt: MONDAY_NOON });
    const statsAfterEdit = store.getCumulativeStats();

    expect(statsAfterEdit.totalSessions).toBe(1); // still one session, not two
    expect(statsAfterEdit.totalVolume).toBeGreaterThan(statsBeforeEdit.totalVolume); // reflects the edit (more reps)
  });
});

describe("deleteSession", () => {
  let store: InMemoryGymStore;
  beforeEach(() => {
    store = new InMemoryGymStore();
  });

  it("removes the session and recomputes cumulative stats down to what remains", () => {
    logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });
    logSession(store, { id: "s2", sets: pushupSets(15, MONDAY_NOON + DAY), loggedAt: MONDAY_NOON + DAY });
    expect(store.getCumulativeStats().totalSessions).toBe(2);

    deleteSession(store, "s2");

    expect(store.getCumulativeStats().totalSessions).toBe(1);
    expect(store.getSession("s2")).toBeUndefined();
  });

  it("deleting the only session resets all derived state to empty", () => {
    logSession(store, { id: "s1", sets: pushupSets(15, MONDAY_NOON), loggedAt: MONDAY_NOON });
    deleteSession(store, "s1");

    const stats = store.getCumulativeStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalXp).toBe(0);
    expect(store.getExerciseHistory()).toEqual({});
    expect(store.getUnlockedAchievementIds().size).toBe(0);
  });

  it("deleting an early session correctly re-chains PRs for the sessions that come after it", () => {
    // s1: 60kg (would be a weight PR); s2: 70kg (weight PR over s1); delete s1 -> s2 becomes the new first-ever log
    logSession(store, {
      id: "s1",
      sets: [{ exerciseId: "barbell-bench-press", weightKg: 60, reps: 8, bodyweightKg: BW, timestamp: MONDAY_NOON }],
      loggedAt: MONDAY_NOON,
    });
    deleteSession(store, "s1");

    const result = logSession(store, {
      id: "s2",
      sets: [{ exerciseId: "barbell-bench-press", weightKg: 70, reps: 8, bodyweightKg: BW, timestamp: MONDAY_NOON + DAY }],
      loggedAt: MONDAY_NOON + DAY,
    });

    // s2 is now the first-ever log of barbell-bench-press -> discovery bonus, no exercise PRs
    // (bodyweightMax still fires — s1's deletion also reset bodyweight history to empty)
    expect(result.xp.prs.some((p) => p.exerciseId === "barbell-bench-press")).toBe(false);
    expect(result.xp.setBreakdowns[0]!.components.some((c) => c.label === "new exercise")).toBe(true);
  });
});
