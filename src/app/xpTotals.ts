import type { MuscleId } from "../domain/muscles.js";

// muscleXpCache holds each muscle's own marginal share (v2 §4.2) but not
// session-level bonuses (streak multiplier, bodyweight PRs) that aren't
// attributable to any one muscle — so this is deliberately a different,
// smaller number than a session's own SessionXpResult.total. It's the
// stable "lifetime XP" figure everything that reads the cache (level-up
// detection, the Today tab, the Progress tab) should agree on.
export function totalMuscleXp(muscleXp: Record<MuscleId, number>): number {
  return Object.values(muscleXp).reduce((sum, amount) => sum + amount, 0);
}
