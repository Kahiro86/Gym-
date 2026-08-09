import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS,
  getAchievementDefinition,
  evaluateAchievements,
  resolveAchievementRewards,
  emptyPrCounts,
} from "../src/domain/achievements.js";
import { MUSCLE_IDS } from "../src/domain/types.js";
import type { PlayerStats } from "../src/domain/achievements.js";
import type { MuscleId } from "../src/domain/types.js";

function baseStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  const muscleXp = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) muscleXp[muscle] = 0;

  return {
    totalXp: 0,
    level: 1,
    totalSessions: 0,
    totalSets: 0,
    totalVolume: 0,
    streakWeeks: 0,
    muscleXp,
    prCounts: emptyPrCounts(),
    ...overrides,
  };
}

describe("ACHIEVEMENTS catalog", () => {
  it("has unique ids", () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
  });

  it("every achievement grants at least xp or a title", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.reward.xp !== undefined || a.reward.title !== undefined, a.id).toBe(true);
    }
  });

  it("nothing unlocks against a completely blank slate", () => {
    expect(evaluateAchievements(baseStats(), [])).toEqual([]);
  });

  it("getAchievementDefinition looks up by id", () => {
    expect(getAchievementDefinition("first-session")?.name).toBe("First Rep");
    expect(getAchievementDefinition("not-real")).toBeUndefined();
  });
});

describe("evaluateAchievements", () => {
  it("unlocks first-session once a session is logged", () => {
    const unlocked = evaluateAchievements(baseStats({ totalSessions: 1 }), []);
    expect(unlocked.map((u) => u.achievementId)).toContain("first-session");
  });

  it("does not re-unlock an achievement already in the caller's unlocked set", () => {
    const unlocked = evaluateAchievements(baseStats({ totalSessions: 1 }), ["first-session"]);
    expect(unlocked.map((u) => u.achievementId)).not.toContain("first-session");
  });

  it("unlocks pr-hunter only once 25 lifetime PRs are recorded", () => {
    const under = evaluateAchievements(baseStats({ prCounts: { ...emptyPrCounts(), weight: 24 } }), []);
    expect(under.map((u) => u.achievementId)).not.toContain("pr-hunter");

    const over = evaluateAchievements(baseStats({ prCounts: { ...emptyPrCounts(), weight: 25 } }), []);
    expect(over.map((u) => u.achievementId)).toContain("pr-hunter");
  });

  it("unlocks first-s-rank only once a muscle actually reaches S", () => {
    const stats = baseStats();
    stats.muscleXp.chestSternal = 8000;
    const unlocked = evaluateAchievements(stats, []);
    expect(unlocked.map((u) => u.achievementId)).toContain("first-s-rank");
  });

  it("no-weak-links requires every single muscle to be off unranked", () => {
    const stats = baseStats();
    for (const muscle of MUSCLE_IDS) stats.muscleXp[muscle] = 10;
    stats.muscleXp.neck = 0; // one muscle still untouched
    expect(evaluateAchievements(stats, []).map((u) => u.achievementId)).not.toContain("no-weak-links");

    stats.muscleXp.neck = 10;
    expect(evaluateAchievements(stats, []).map((u) => u.achievementId)).toContain("no-weak-links");
  });

  it("returns multiple simultaneous unlocks when several thresholds are crossed at once", () => {
    const stats = baseStats({ totalSessions: 100, level: 20 });
    const unlocked = evaluateAchievements(stats, []).map((u) => u.achievementId);
    expect(unlocked).toEqual(
      expect.arrayContaining(["first-session", "ten-sessions", "fifty-sessions", "hundred-sessions", "level-5", "level-10", "level-20"])
    );
  });
});

describe("resolveAchievementRewards", () => {
  it("sums bonus XP from every newly unlocked achievement", () => {
    const stats = baseStats({ totalSessions: 1 });
    const result = resolveAchievementRewards(stats, []);
    const firstSession = result.unlocked.find((u) => u.achievementId === "first-session");
    expect(firstSession?.reward.xp).toBe(25);
    expect(result.bonusXp).toBeGreaterThanOrEqual(25);
    expect(result.finalTotalXp).toBe(stats.totalXp + result.bonusXp);
  });

  it("cascades: a reward's own XP can cross another achievement's XP threshold in the same call", () => {
    // 490 + first-pr's +20 XP reward crosses the 500 XP-hoarder threshold.
    const stats = baseStats({ totalXp: 490, prCounts: { ...emptyPrCounts(), weight: 1 } });
    const result = resolveAchievementRewards(stats, []);

    const ids = result.unlocked.map((u) => u.achievementId);
    expect(ids).toContain("first-pr");
    expect(ids).toContain("xp-hoarder");
    expect(result.finalTotalXp).toBeGreaterThanOrEqual(500);
  });

  it("never unlocks the same achievement twice across repeated calls with an updated unlocked set", () => {
    const stats = baseStats({ totalSessions: 1 });
    const first = resolveAchievementRewards(stats, []);
    const unlockedIds = first.unlocked.map((u) => u.achievementId);

    const second = resolveAchievementRewards(stats, unlockedIds);
    expect(second.unlocked).toEqual([]);
    expect(second.bonusXp).toBe(0);
  });

  it("terminates even when nothing new unlocks", () => {
    const result = resolveAchievementRewards(baseStats(), []);
    expect(result.unlocked).toEqual([]);
    expect(result.bonusXp).toBe(0);
    expect(result.finalTotalXp).toBe(0);
  });
});
