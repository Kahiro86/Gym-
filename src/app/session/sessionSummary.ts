import type { LevelProgress } from "../../domain/progression.js";
import type { SessionXpResult } from "../../domain/types.js";
import type { MuscleId } from "../../domain/muscles.js";

// Handed from ActiveSessionScreen to SessionSummaryScreen via router
// navigation state (spec §14 task 12) — this moment only exists once, right
// after a session finishes, so there's nothing worth persisting it as.
export interface SessionSummaryState {
  xp: SessionXpResult;
  levelBefore: LevelProgress;
  levelAfter: LevelProgress;
}

// muscleXpCache holds each muscle's own marginal share (v2 §4.2) but not
// session-level bonuses (streak multiplier, bodyweight PRs) that aren't
// attributable to any one muscle — so this is a deliberately different,
// smaller number than SessionXpResult.total. It's the same "lifetime XP"
// the Progress tab (Task 15) will read from the same cache, which is what
// makes it the right input for levelFromTotalXp() here.
export function totalMuscleXp(muscleXp: Record<MuscleId, number>): number {
  return Object.values(muscleXp).reduce((sum, amount) => sum + amount, 0);
}
