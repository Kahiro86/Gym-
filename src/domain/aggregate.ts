import { computeSetVolume } from "./load.js";
import { requireExercise } from "./catalog.js";
import { XP_CONSTANT } from "./xp.js";
import { MUSCLE_IDS } from "./types.js";
import type { LoggedSet, MuscleId } from "./types.js";

// A lightweight, PR/diminishing-return-free muscle split — useful for
// previewing the hexagon while a set is being entered, before history is
// known. computeSessionXp is the source of truth for actual progression.
export function aggregateMuscleXp(sets: LoggedSet[], bodyweightKg: number): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) {
    record[muscle] = 0;
  }

  for (const set of sets) {
    const exercise = requireExercise(set.exerciseId);
    const volume = computeSetVolume(exercise, set, bodyweightKg);
    const baseXp = XP_CONSTANT * Math.sqrt(volume / exercise.referenceVolume);

    for (const contribution of exercise.muscles) {
      record[contribution.muscle] += baseXp * contribution.share;
    }
  }

  return record;
}

export interface SessionTotals {
  totalVolume: number;
  totalSets: number;
  muscleVolume: Record<MuscleId, number>;
}

export function aggregateSessionTotals(sets: LoggedSet[], bodyweightKg: number): SessionTotals {
  const muscleVolume = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) {
    muscleVolume[muscle] = 0;
  }

  let totalVolume = 0;

  for (const set of sets) {
    const exercise = requireExercise(set.exerciseId);
    const volume = computeSetVolume(exercise, set, bodyweightKg);
    totalVolume += volume;

    for (const contribution of exercise.muscles) {
      muscleVolume[contribution.muscle] += volume * contribution.share;
    }
  }

  return { totalVolume, totalSets: sets.length, muscleVolume };
}
