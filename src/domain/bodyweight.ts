import { emptyBodyweightHistory } from "./types.js";
import type { BodyweightHistory, Pr } from "./types.js";

// exerciseId sentinel for bodyweight PRs — they aren't tied to any exercise
// in the catalog, they're a lifetime record of the user's own bodyweight.
export const BODYWEIGHT_PR_SUBJECT = "bodyweight";

// Only one of max/min fires per check (max wins ties on the very first
// entry) so a fresh account doesn't get double-credited for one log.
export function detectBodyweightPrs(bodyweightKg: number, history: BodyweightHistory | undefined): Pr[] {
  const h = history ?? emptyBodyweightHistory();

  if (bodyweightKg > h.maxBodyweightKg) {
    return [
      {
        type: "bodyweightMax",
        exerciseId: BODYWEIGHT_PR_SUBJECT,
        value: bodyweightKg,
        previousBest: h.maxBodyweightKg,
      },
    ];
  }

  if (bodyweightKg < h.minBodyweightKg) {
    return [
      {
        type: "bodyweightMin",
        exerciseId: BODYWEIGHT_PR_SUBJECT,
        value: bodyweightKg,
        previousBest: Number.isFinite(h.minBodyweightKg) ? h.minBodyweightKg : bodyweightKg,
      },
    ];
  }

  return [];
}

export function recordBodyweightIntoHistory(
  bodyweightKg: number,
  history: BodyweightHistory | undefined
): BodyweightHistory {
  const h = history ?? emptyBodyweightHistory();
  return {
    maxBodyweightKg: Math.max(h.maxBodyweightKg, bodyweightKg),
    minBodyweightKg: Math.min(h.minBodyweightKg, bodyweightKg),
  };
}
