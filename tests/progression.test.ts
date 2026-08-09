import { describe, it, expect } from "vitest";
import { xpRequiredForLevel, levelFromTotalXp, rankForMuscleXp } from "../src/domain/progression.js";

describe("xpRequiredForLevel", () => {
  it("level 1 costs 100 XP, matching the prototype's 0/100", () => {
    expect(xpRequiredForLevel(1)).toBe(100);
  });

  it("is strictly increasing", () => {
    for (let level = 1; level < 50; level++) {
      expect(xpRequiredForLevel(level + 1)).toBeGreaterThan(xpRequiredForLevel(level));
    }
  });

  it("requires roughly 1600 XP at level 20", () => {
    expect(xpRequiredForLevel(20)).toBeGreaterThan(1400);
    expect(xpRequiredForLevel(20)).toBeLessThan(1800);
  });
});

describe("levelFromTotalXp", () => {
  it("inverts xpRequiredForLevel across a wide range of levels", () => {
    let cumulative = 0;
    for (let level = 1; level <= 30; level++) {
      const result = levelFromTotalXp(cumulative);
      expect(result.level).toBe(level);
      expect(result.xpIntoLevel).toBe(0);
      cumulative += xpRequiredForLevel(level);
    }
  });

  it("reports partial progress into the current level", () => {
    const result = levelFromTotalXp(60);
    expect(result.level).toBe(1);
    expect(result.xpIntoLevel).toBe(60);
    expect(result.xpForNext).toBe(100);
  });

  it("never returns negative or NaN values", () => {
    for (const xp of [0, -50, 1, 1_000_000]) {
      const result = levelFromTotalXp(xp);
      expect(Number.isNaN(result.level)).toBe(false);
      expect(result.level).toBeGreaterThanOrEqual(1);
      expect(result.xpIntoLevel).toBeGreaterThanOrEqual(0);
    }
  });

  it("a realistic first session (60-90 XP) nearly or fully levels the player up", () => {
    const result = levelFromTotalXp(90);
    expect(result.xpIntoLevel).toBeLessThan(xpRequiredForLevel(1));
    expect(90 / xpRequiredForLevel(1)).toBeGreaterThan(0.5);
  });
});

describe("rankForMuscleXp", () => {
  it("shows unranked, not F, for an untrained muscle", () => {
    expect(rankForMuscleXp(0)).toBe("unranked");
  });

  it("ranks F once a muscle has any XP but under the E threshold", () => {
    expect(rankForMuscleXp(1)).toBe("F");
    expect(rankForMuscleXp(49)).toBe("F");
  });

  it("crosses thresholds correctly", () => {
    expect(rankForMuscleXp(50)).toBe("E");
    expect(rankForMuscleXp(200)).toBe("D");
    expect(rankForMuscleXp(600)).toBe("C");
    expect(rankForMuscleXp(1500)).toBe("B");
    expect(rankForMuscleXp(3500)).toBe("A");
    expect(rankForMuscleXp(8000)).toBe("S");
    expect(rankForMuscleXp(50_000)).toBe("S");
  });

  it("can never fall as cumulative XP only grows", () => {
    const order: Array<ReturnType<typeof rankForMuscleXp>> = [
      "unranked",
      "F",
      "E",
      "D",
      "C",
      "B",
      "A",
      "S",
    ];
    const xpSamples = [0, 10, 60, 250, 700, 1600, 4000, 9000];
    const ranks = xpSamples.map(rankForMuscleXp);
    let lastIndex = -1;
    for (const rank of ranks) {
      const index = order.indexOf(rank);
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
    }
  });
});
