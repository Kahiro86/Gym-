import { computeSetVolume } from "./load.js";
import { requireExercise } from "./registry.js";
import { XP_CONSTANT } from "./xp.js";
import { MUSCLE_IDS } from "./muscles.js";
import type { LoggedSet } from "./types.js";
import type { MuscleId } from "./muscles.js";

function emptyMuscleRecord(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) {
    record[muscle] = 0;
  }
  return record;
}

// A history/bonus-free preview: the same per-muscle-per-session effort/sqrt
// compression computeSessionXp uses (v2 §4.2), without PRs or session
// bonuses — useful for previewing the hexagon while sets are being entered,
// before history is known. computeSessionXp is the source of truth for
// actual progression.
export function aggregateMuscleXp(sets: LoggedSet[]): Record<MuscleId, number> {
  const cumulativeEffort = emptyMuscleRecord();
  const muscleXp = emptyMuscleRecord();

  for (const set of sets) {
    const exercise = requireExercise(set.exerciseId);
    const volume = computeSetVolume(exercise, set);
    const effortDelta = volume / exercise.referenceVolume;

    for (const contribution of exercise.muscles) {
      if (contribution.share <= 0) continue;
      const before = cumulativeEffort[contribution.muscle];
      const after = before + effortDelta * contribution.share;
      cumulativeEffort[contribution.muscle] = after;
      muscleXp[contribution.muscle] += XP_CONSTANT * (Math.sqrt(after) - Math.sqrt(before));
    }
  }

  return muscleXp;
}

// Raw per-muscle volume, undecorated by any XP math — the input Layer 2's
// heatmap rollup consumes directly (v2 §6: aggregateMuscleVolume).
export function aggregateMuscleVolume(sets: LoggedSet[]): Record<MuscleId, number> {
  const result = emptyMuscleRecord();

  for (const set of sets) {
    const exercise = requireExercise(set.exerciseId);
    const volume = computeSetVolume(exercise, set);
    for (const contribution of exercise.muscles) {
      result[contribution.muscle] += volume * contribution.share;
    }
  }

  return result;
}

export interface SessionTotals {
  totalVolume: number;
  totalSets: number;
  muscleVolume: Record<MuscleId, number>;
}

export function aggregateSessionTotals(sets: LoggedSet[]): SessionTotals {
  const muscleVolume = emptyMuscleRecord();
  let totalVolume = 0;

  for (const set of sets) {
    const exercise = requireExercise(set.exerciseId);
    const volume = computeSetVolume(exercise, set);
    totalVolume += volume;

    for (const contribution of exercise.muscles) {
      muscleVolume[contribution.muscle] += volume * contribution.share;
    }
  }

  return { totalVolume, totalSets: sets.length, muscleVolume };
}
