import type { Rank, RankOrUnranked } from "./types.js";

const CURVE_SEAM_LEVEL = 25;

// v2 §5.1: pure 1.15^(n-1) growth makes cost exponential while income
// (sqrt-compressed, reference-volume-normalized) is near-flat — level 30
// cost ~19 weeks of play, level 40 ~78. Growth switches to a gentler 1.06
// past the seam so late progression stays perceptible without the wall.
export function xpRequiredForLevel(level: number): number {
  if (level <= CURVE_SEAM_LEVEL) {
    return Math.round(100 * Math.pow(1.15, level - 1));
  }
  return Math.round(100 * Math.pow(1.15, CURVE_SEAM_LEVEL - 1) * Math.pow(1.06, level - CURVE_SEAM_LEVEL));
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
}

export function levelFromTotalXp(totalXp: number): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, totalXp);

  let requiredForCurrent = xpRequiredForLevel(level);
  while (remaining >= requiredForCurrent) {
    remaining -= requiredForCurrent;
    level += 1;
    requiredForCurrent = xpRequiredForLevel(level);
  }

  return { level, xpIntoLevel: remaining, xpForNext: requiredForCurrent };
}

const RANK_THRESHOLDS: Array<{ rank: Rank; minXp: number }> = [
  { rank: "S", minXp: 8000 },
  { rank: "A", minXp: 3500 },
  { rank: "B", minXp: 1500 },
  { rank: "C", minXp: 600 },
  { rank: "D", minXp: 200 },
  { rank: "E", minXp: 50 },
  { rank: "F", minXp: 0 },
];

export function rankForMuscleXp(muscleXp: number): RankOrUnranked {
  if (muscleXp <= 0) return "unranked";
  const match = RANK_THRESHOLDS.find((t) => muscleXp >= t.minXp);
  return match ? match.rank : "unranked";
}
