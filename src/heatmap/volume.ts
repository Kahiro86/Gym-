import { computeSetVolume } from "../domain/load.js";
import { requireExercise } from "../domain/registry.js";
import type { LoggedSet } from "../domain/types.js";
import type { MuscleId } from "../domain/muscles.js";

// §4: volume = reps x load, with load resolution coming from Layer 1's
// load-type taxonomy — what makes the pushup bug structurally impossible
// here too. exercise.muscles is already head-level with primaryMover
// (Layer 1 catalog.ts authors it that way now), so this just reads it —
// no separate derivation lives in Layer 2 anymore.

export function computeSetMuscleVolumes(set: LoggedSet): Partial<Record<MuscleId, number>> {
  const exercise = requireExercise(set.exerciseId);
  const volume = computeSetVolume(exercise, set);
  if (volume <= 0) return {};

  const result: Partial<Record<MuscleId, number>> = {};
  for (const contribution of exercise.muscles) {
    if (contribution.share <= 0) continue;
    result[contribution.muscle] = (result[contribution.muscle] ?? 0) + volume * contribution.share;
  }
  return result;
}

export function primaryMusclesTouched(set: LoggedSet): MuscleId[] {
  const exercise = requireExercise(set.exerciseId);
  return exercise.muscles.filter((c) => c.primaryMover).map((c) => c.muscle);
}
