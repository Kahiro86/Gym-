import type { Exercise, LoggedSet } from "./types.js";

export function resolveEffectiveLoad(
  exercise: Exercise,
  set: LoggedSet,
  bodyweightKg: number
): number {
  if (exercise.components) {
    // Every loadType's effective load already comes out in the same
    // kg-equivalent unit, so summing across mixed-loadType components stays
    // dimensionally meaningful (e.g. a bodyweight pushup + a barbell row).
    return exercise.components.reduce(
      (sum, component) => sum + resolveEffectiveLoad(component, set, bodyweightKg),
      0
    );
  }

  const entered = set.weightKg ?? 0;

  switch (exercise.loadType) {
    case "barbell":
    case "machine":
    case "cable":
      return entered;
    case "dumbbell":
      return entered * 2;
    case "bodyweight":
      return bodyweightKg * requireLeverage(exercise);
    case "weighted_bodyweight":
      return bodyweightKg * requireLeverage(exercise) + entered;
    case "assisted":
      return Math.max(0, bodyweightKg * requireLeverage(exercise) - entered);
    case "time":
      return requireIntensity(exercise);
    case "distance":
      return bodyweightKg * requireIntensity(exercise);
  }
}

// The "quantity" a set's effective load is multiplied by to get volume:
// reps for weight/bodyweight exercises, seconds for time-based, meters for
// distance-based. Unilateral sets log reps/duration per side, so the total
// work performed is double what was entered.
function quantity(exercise: Exercise, set: LoggedSet): number {
  const sides = exercise.unilateral ? 2 : 1;

  if (exercise.loadType === "time") {
    return (set.durationSec ?? 0) * sides;
  }
  if (exercise.loadType === "distance") {
    return (set.distanceM ?? 0) * sides;
  }
  return (set.reps ?? 0) * sides;
}

export function computeSetVolume(
  exercise: Exercise,
  set: LoggedSet,
  bodyweightKg: number
): number {
  if (exercise.components) {
    // Each component computes its own load x its own quantity (reps, secs,
    // or meters) independently, then the set's total volume is their sum —
    // this is what lets a compound mix reps-based and time-based movements
    // in one LoggedSet.
    return Math.max(
      0,
      exercise.components.reduce((sum, component) => sum + computeSetVolume(component, set, bodyweightKg), 0)
    );
  }

  const load = resolveEffectiveLoad(exercise, set, bodyweightKg);
  const qty = quantity(exercise, set);
  return Math.max(0, load * qty);
}

function requireLeverage(exercise: Exercise): number {
  if (exercise.leverageFactor === undefined) {
    throw new Error(`Exercise "${exercise.id}" (${exercise.loadType}) is missing leverageFactor`);
  }
  return exercise.leverageFactor;
}

function requireIntensity(exercise: Exercise): number {
  if (exercise.intensityFactor === undefined) {
    throw new Error(`Exercise "${exercise.id}" (${exercise.loadType}) is missing intensityFactor`);
  }
  return exercise.intensityFactor;
}
