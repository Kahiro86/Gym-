import { resolveEffectiveLoad, computeSetVolume } from "./load.js";
import type { Exercise, ExerciseHistory, LoggedSet, Pr } from "./types.js";

// v2 §4.6: no PRs fire on an exercise's first-ever log (the discovery
// bonus replaces them — otherwise all three PR types trivially fire
// against empty history, making a first session mostly bonus rather than
// training). `history === undefined` is exactly that signal: a key absent
// from HistoryContext.exerciseHistory means this exercise has never been
// logged before, as opposed to a present-but-zeroed record.
export function detectPrs(exercise: Exercise, set: LoggedSet, history: ExerciseHistory | undefined): Pr[] {
  if (history === undefined) {
    return [];
  }

  const effectiveLoad = resolveEffectiveLoad(exercise, set);
  const volume = computeSetVolume(exercise, set);
  const prs: Pr[] = [];

  if (!isLoadFree(exercise) && effectiveLoad > history.maxWeightKg) {
    prs.push({
      type: "weight",
      exerciseId: exercise.id,
      value: effectiveLoad,
      previousBest: history.maxWeightKg,
    });
  }

  if (usesReps(exercise) && set.reps !== undefined) {
    const bestRepsAtOrAbove = history.repsAtLoad
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

  if (volume > history.maxVolumeSingleSet) {
    prs.push({
      type: "volume",
      exerciseId: exercise.id,
      value: volume,
      previousBest: history.maxVolumeSingleSet,
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

export function recordSetIntoHistory(exercise: Exercise, set: LoggedSet, history: ExerciseHistory | undefined): ExerciseHistory {
  const h = history ?? { maxWeightKg: 0, maxVolumeSingleSet: 0, repsAtLoad: [] };
  const effectiveLoad = resolveEffectiveLoad(exercise, set);
  const volume = computeSetVolume(exercise, set);

  return {
    maxWeightKg: Math.max(h.maxWeightKg, effectiveLoad),
    maxVolumeSingleSet: Math.max(h.maxVolumeSingleSet, volume),
    repsAtLoad: set.reps !== undefined ? [...h.repsAtLoad, { loadKg: effectiveLoad, reps: set.reps }] : h.repsAtLoad,
  };
}
