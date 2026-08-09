import { EXERCISE_CATALOG, getExercise as getSeedExercise } from "./catalog.js";
import { getCompoundExercise, listCompoundExercises } from "./compound.js";
import type { Exercise } from "./types.js";

// Unified lookup across the seeded catalog and runtime-registered compound
// exercises. computeSessionXp / aggregate.ts / search.ts all resolve through
// here so a compound behaves exactly like any other exercise once created.

export function getExercise(id: string): Exercise | undefined {
  return getCompoundExercise(id) ?? getSeedExercise(id);
}

export function requireExercise(id: string): Exercise {
  const exercise = getExercise(id);
  if (!exercise) {
    throw new Error(`Unknown exercise id: ${id}`);
  }
  return exercise;
}

export function allExercises(): Exercise[] {
  return [...EXERCISE_CATALOG, ...listCompoundExercises()];
}
