import type { SetRecord } from "../../storage/types.js";

// Shared by SetList and LastPerformanceLine so a set reads identically
// wherever it's shown. Checks weight+reps before reps-alone since
// weighted_bodyweight/assisted sets carry both.
export function formatSetSummary(set: SetRecord): string {
  if (set.weightKg !== null && set.reps !== null) return `${set.weightKg} kg × ${set.reps}`;
  if (set.reps !== null) return `${set.reps} reps`;
  if (set.durationSec !== null) return `${set.durationSec}s`;
  if (set.distanceM !== null) return `${set.distanceM} m`;
  return "—";
}
