import { resolveEffectiveLoad, computeSetVolume } from "./load.js";
import type { Exercise, ExerciseHistory, LoggedSet, Pr } from "./types.js";
import { emptyExerciseHistory } from "./types.js";

export function detectPrs(
  exercise: Exercise,
  set: LoggedSet,
  history: ExerciseHistory | undefined,
  bodyweightKg: number
): Pr[] {
  const h = history ?? emptyExerciseHistory();
  const effectiveLoad = resolveEffectiveLoad(exercise, set, bodyweightKg);
  const volume = computeSetVolume(exercise, set, bodyweightKg);
  const prs: Pr[] = [];

  if (!isLoadFree(exercise) && effectiveLoad > h.maxWeightKg) {
    prs.push({
      type: "weight",
      exerciseId: exercise.id,
      value: effectiveLoad,
      previousBest: h.maxWeightKg,
    });
  }

  if (usesReps(exercise) && set.reps !== undefined) {
    const bestRepsAtOrAbove = h.repsAtLoad
      .filter((r) => r.loadKg >= effectiveLoad)
      .reduce((max, r) => Math.max(max, r.reps), 0);

    if (set.reps > bestRepsAtOrAbove) {
      prs.push({
        type: "rep",
        exerciseId: exercise.id,
        value: set.reps,
        previousBest: bestRepsAtOrAbove,
      });
    }
  }

  if (volume > h.maxVolumeSingleSet) {
    prs.push({
      type: "volume",
      exerciseId: exercise.id,
      value: volume,
      previousBest: h.maxVolumeSingleSet,
    });
  }

  return prs;
}

// A compound is "load-free" only if every one of its components is (i.e.
// entirely made of time-based holds); it "uses reps" if any component does.
function isLoadFree(exercise: Exercise): boolean {
  if (exercise.components) return exercise.components.every(isLoadFree);
  return exercise.loadType === "time";
}

function usesReps(exercise: Exercise): boolean {
  if (exercise.components) return exercise.components.some(usesReps);
  return exercise.loadType !== "time" && exercise.loadType !== "distance";
}

export function recordSetIntoHistory(
  exercise: Exercise,
  set: LoggedSet,
  history: ExerciseHistory | undefined,
  bodyweightKg: number
): ExerciseHistory {
  const h = history ?? emptyExerciseHistory();
  const effectiveLoad = resolveEffectiveLoad(exercise, set, bodyweightKg);
  const volume = computeSetVolume(exercise, set, bodyweightKg);

  return {
    maxWeightKg: Math.max(h.maxWeightKg, effectiveLoad),
    maxVolumeSingleSet: Math.max(h.maxVolumeSingleSet, volume),
    repsAtLoad:
      set.reps !== undefined
        ? [...h.repsAtLoad, { loadKg: effectiveLoad, reps: set.reps }]
        : h.repsAtLoad,
  };
}
