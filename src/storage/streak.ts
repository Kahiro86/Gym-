import { weekStartFor, addWeeks } from "../shared/dates.js";
import type { StoredSession } from "./types.js";

// Consecutive weeks (Monday-start, matching heatmap's week semantics) with
// at least one session, counting back from "now". The current week gets a
// grace period: if it has no session *yet*, that alone doesn't break the
// streak — it isn't over until the week ends without one. Pure function,
// nowMs passed explicitly (no Date.now() in the core).
export function computeStreakWeeks(sessions: StoredSession[], nowMs: number): number {
  const weeksWithSessions = new Set(sessions.map((s) => weekStartFor(s.loggedAt)));

  let cursor = weekStartFor(nowMs);
  if (!weeksWithSessions.has(cursor)) {
    cursor = addWeeks(cursor, -1);
  }

  let streak = 0;
  while (weeksWithSessions.has(cursor)) {
    streak++;
    cursor = addWeeks(cursor, -1);
  }
  return streak;
}
