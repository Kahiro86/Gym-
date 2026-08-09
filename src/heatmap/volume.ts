import { computeSetVolume } from "../domain/load.js";
import { requireExercise } from "../domain/registry.js";
import { computeHeatmapContributions } from "./muscleWeights.js";
import type { LoggedSet } from "../domain/types.js";
import type { HeatmapMuscleId } from "./registry.js";

// §4: volume = reps x load, with load resolution coming from the existing
// Layer 1 load-type taxonomy (computeSetVolume) — this is what makes the
// pushup bug (§11 regression test) structurally impossible here too.

export function computeSetMuscleVolumes(set: LoggedSet, bodyweightKg: number): Partial<Record<HeatmapMuscleId, number>> {
  const exercise = requireExercise(set.exerciseId);
  const volume = computeSetVolume(exercise, set, bodyweightKg);
  if (volume <= 0) return {};

  const result: Partial<Record<HeatmapMuscleId, number>> = {};
  for (const contribution of computeHeatmapContributions(exercise)) {
    if (contribution.weight <= 0) continue;
    result[contribution.muscle] = (result[contribution.muscle] ?? 0) + volume * contribution.weight;
  }
  return result;
}

export function primaryMusclesTouched(set: LoggedSet): HeatmapMuscleId[] {
  const exercise = requireExercise(set.exerciseId);
  return computeHeatmapContributions(exercise)
    .filter((c) => c.primary)
    .map((c) => c.muscle);
}
