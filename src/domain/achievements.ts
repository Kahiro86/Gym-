import { rankForMuscleXp } from "./progression.js";
import { MUSCLE_IDS } from "./types.js";
import type { MuscleId, PrType } from "./types.js";

// The reward + achievement system is entirely derived: there is no setter
// that flips an achievement to "unlocked." A caller assembles PlayerStats
// from whatever it already persists (session totals, PR counts, muscle XP —
// nothing new to store), and evaluateAchievements/resolveAchievementRewards
// tell it what's newly true. Call it after every session; that's the whole
// integration surface. The catalog itself is fixed game data, not
// user-authored, so — unlike the exercise catalog — there's no
// createAchievement() registration API.

export interface Reward {
  xp?: number;
  title?: string;
}

export interface PlayerStats {
  totalXp: number;
  level: number;
  totalSessions: number;
  totalSets: number;
  totalVolume: number;
  streakWeeks: number;
  muscleXp: Record<MuscleId, number>;
  prCounts: Record<PrType, number>;
}

export function emptyPrCounts(): Record<PrType, number> {
  return { weight: 0, rep: 0, volume: 0, bodyweightMax: 0, bodyweightMin: 0 };
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  reward: Reward;
  isUnlocked: (stats: PlayerStats) => boolean;
}

export interface UnlockedAchievement {
  achievementId: string;
  name: string;
  reward: Reward;
}

function totalPrCount(stats: PlayerStats): number {
  return Object.values(stats.prCounts).reduce((sum, n) => sum + n, 0);
}

function bestMuscleRank(stats: PlayerStats): ReturnType<typeof rankForMuscleXp>[] {
  return MUSCLE_IDS.map((muscle) => rankForMuscleXp(stats.muscleXp[muscle] ?? 0));
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "first-session",
    name: "First Rep",
    description: "Log your first training session.",
    reward: { xp: 25 },
    isUnlocked: (s) => s.totalSessions >= 1,
  },
  {
    id: "ten-sessions",
    name: "Building the Habit",
    description: "Log 10 training sessions.",
    reward: { xp: 50 },
    isUnlocked: (s) => s.totalSessions >= 10,
  },
  {
    id: "fifty-sessions",
    name: "Iron Routine",
    description: "Log 50 training sessions.",
    reward: { xp: 150 },
    isUnlocked: (s) => s.totalSessions >= 50,
  },
  {
    id: "hundred-sessions",
    name: "Centurion",
    description: "Log 100 training sessions.",
    reward: { xp: 300, title: "Centurion" },
    isUnlocked: (s) => s.totalSessions >= 100,
  },
  {
    id: "level-5",
    name: "Rising Athlete",
    description: "Reach level 5.",
    reward: { xp: 50 },
    isUnlocked: (s) => s.level >= 5,
  },
  {
    id: "level-10",
    name: "Seasoned Lifter",
    description: "Reach level 10.",
    reward: { xp: 100 },
    isUnlocked: (s) => s.level >= 10,
  },
  {
    id: "level-20",
    name: "Elite Physique",
    description: "Reach level 20.",
    reward: { xp: 250, title: "Elite" },
    isUnlocked: (s) => s.level >= 20,
  },
  {
    id: "first-pr",
    name: "First Record",
    description: "Set your first PR of any kind.",
    reward: { xp: 20 },
    isUnlocked: (s) => totalPrCount(s) >= 1,
  },
  {
    id: "pr-hunter",
    name: "PR Hunter",
    description: "Set 25 lifetime PRs.",
    reward: { xp: 100 },
    isUnlocked: (s) => totalPrCount(s) >= 25,
  },
  {
    id: "pr-machine",
    name: "PR Machine",
    description: "Set 100 lifetime PRs.",
    reward: { xp: 300, title: "PR Machine" },
    isUnlocked: (s) => totalPrCount(s) >= 100,
  },
  {
    id: "heavy-hitter",
    name: "Heavy Hitter",
    description: "Set 10 lifetime weight PRs.",
    reward: { xp: 100 },
    isUnlocked: (s) => s.prCounts.weight >= 10,
  },
  {
    id: "body-recomposition",
    name: "Body Recomposition",
    description: "Log a new all-time bodyweight high or low.",
    reward: { xp: 20 },
    isUnlocked: (s) => s.prCounts.bodyweightMax + s.prCounts.bodyweightMin >= 1,
  },
  {
    id: "century-volume",
    name: "Century Volume",
    description: "Move 100,000 kg of lifetime volume.",
    reward: { xp: 75 },
    isUnlocked: (s) => s.totalVolume >= 100_000,
  },
  {
    id: "ton-volume",
    name: "Ton Club",
    description: "Move 1,000,000 kg of lifetime volume.",
    reward: { xp: 400, title: "Ton Club" },
    isUnlocked: (s) => s.totalVolume >= 1_000_000,
  },
  {
    id: "streak-4",
    name: "One Month Strong",
    description: "Reach a 4-week training streak.",
    reward: { xp: 60 },
    isUnlocked: (s) => s.streakWeeks >= 4,
  },
  {
    id: "streak-12",
    name: "Quarter Iron",
    description: "Reach a 12-week training streak.",
    reward: { xp: 200, title: "Unbreakable" },
    isUnlocked: (s) => s.streakWeeks >= 12,
  },
  {
    id: "first-s-rank",
    name: "S-Tier",
    description: "Reach S rank in any muscle.",
    reward: { xp: 250, title: "S-Tier" },
    isUnlocked: (s) => bestMuscleRank(s).includes("S"),
  },
  {
    id: "no-weak-links",
    name: "Full House",
    description: "Get every muscle off unranked.",
    reward: { xp: 150, title: "Well-Rounded" },
    isUnlocked: (s) => bestMuscleRank(s).every((rank) => rank !== "unranked"),
  },
  {
    id: "xp-hoarder",
    name: "XP Hoarder",
    description: "Accumulate 500 lifetime XP.",
    reward: { title: "Grinder" },
    isUnlocked: (s) => s.totalXp >= 500,
  },
  {
    id: "xp-legend",
    name: "XP Legend",
    description: "Accumulate 5,000 lifetime XP.",
    reward: { title: "Legend" },
    isUnlocked: (s) => s.totalXp >= 5000,
  },
];

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function evaluateAchievements(
  stats: PlayerStats,
  alreadyUnlockedIds: ReadonlySet<string> | readonly string[]
): UnlockedAchievement[] {
  const unlockedSet = alreadyUnlockedIds instanceof Set ? alreadyUnlockedIds : new Set(alreadyUnlockedIds);

  return ACHIEVEMENTS.filter((a) => !unlockedSet.has(a.id) && a.isUnlocked(stats)).map((a) => ({
    achievementId: a.id,
    name: a.name,
    reward: a.reward,
  }));
}

export interface AchievementUnlockResult {
  unlocked: UnlockedAchievement[];
  bonusXp: number;
  finalTotalXp: number;
}

// Resolves unlocks in passes because a reward's own XP can push totalXp
// over another achievement's threshold — bounded by ACHIEVEMENTS.length
// since each pass unlocks at least one new achievement or the loop stops.
export function resolveAchievementRewards(
  stats: PlayerStats,
  alreadyUnlockedIds: ReadonlySet<string> | readonly string[]
): AchievementUnlockResult {
  const unlockedSet = new Set(alreadyUnlockedIds);
  const allUnlocked: UnlockedAchievement[] = [];
  let bonusXp = 0;

  for (let pass = 0; pass < ACHIEVEMENTS.length; pass++) {
    const currentStats: PlayerStats = { ...stats, totalXp: stats.totalXp + bonusXp };
    const newlyUnlocked = evaluateAchievements(currentStats, unlockedSet);
    if (newlyUnlocked.length === 0) break;

    for (const unlocked of newlyUnlocked) {
      unlockedSet.add(unlocked.achievementId);
      bonusXp += unlocked.reward.xp ?? 0;
      allUnlocked.push(unlocked);
    }
  }

  return { unlocked: allUnlocked, bonusXp, finalTotalXp: stats.totalXp + bonusXp };
}
