import type { LevelProgress } from "../../domain/progression.js";
import type { SessionXpResult } from "../../domain/types.js";

// Handed from ActiveSessionScreen to SessionSummaryScreen via router
// navigation state (spec §14 task 12) — this moment only exists once, right
// after a session finishes, so there's nothing worth persisting it as.
export interface SessionSummaryState {
  xp: SessionXpResult;
  levelBefore: LevelProgress;
  levelAfter: LevelProgress;
}
