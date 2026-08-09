import { allExercises } from "./registry.js";
import type { Equipment, Exercise, LoadType, MuscleId } from "./types.js";

export interface ExerciseSearchOptions {
  muscle?: MuscleId;
  equipment?: Equipment;
  loadType?: LoadType;
}

export function searchExercises(query: string, options: ExerciseSearchOptions = {}): Exercise[] {
  const q = query.trim().toLowerCase();

  return allExercises()
    .filter((exercise) => matchesFilters(exercise, options))
    .map((exercise) => ({ exercise, score: relevance(exercise, q) }))
    .filter((entry) => q === "" || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
    .map((entry) => entry.exercise);
}

function matchesFilters(exercise: Exercise, options: ExerciseSearchOptions): boolean {
  if (options.muscle && !exercise.muscles.some((m) => m.muscle === options.muscle)) return false;
  if (options.equipment && !exercise.equipment.includes(options.equipment)) return false;
  if (options.loadType && !hasLoadType(exercise, options.loadType)) return false;
  return true;
}

// exercise.loadType is only the first component's type for a compound
// (advisory/display only — see types.ts) — a mixed-load-type compound can
// contain a real match for `loadType` in a non-first component, so this
// has to walk the whole component tree rather than trust the top-level field.
function hasLoadType(exercise: Exercise, loadType: LoadType): boolean {
  if (exercise.components) {
    return exercise.components.some((c) => hasLoadType(c, loadType));
  }
  return exercise.loadType === loadType;
}

function relevance(exercise: Exercise, q: string): number {
  if (q === "") return 1;

  const name = exercise.name.toLowerCase();
  if (name === q) return 100;
  if (exercise.aliases.some((a) => a.toLowerCase() === q)) return 90;
  if (name.startsWith(q)) return 80;
  if (exercise.aliases.some((a) => a.toLowerCase().startsWith(q))) return 70;
  if (name.includes(q)) return 60;
  if (exercise.aliases.some((a) => a.toLowerCase().includes(q))) return 50;
  if (exercise.id.includes(q)) return 40;
  if (exercise.muscles.some((m) => m.muscle.toLowerCase() === q)) return 30;
  if (exercise.equipment.some((e) => e.toLowerCase().includes(q))) return 20;
  return 0;
}
