import type { Exercise, LoggedSet } from "./types.js";

// §3.6: metres aren't rep-comparable on their own — this converts them
// into the same rough unit reps/seconds already live in. Seeded at 1/10
// per spec; a tuning constant, not physiology.
export const DISTANCE_SCALE = 0.1;

export function resolveEffectiveLoad(exercise: Exercise, set: LoggedSet): number {
  if (exercise.components) {
    // Every loadType's effective load already comes out in the same
    // kg-equivalent unit, so summing across mixed-loadType components stays
    // dimensionally meaningful (e.g. a bodyweight pushup + a barbell row).
    return exercise.components.reduce((sum, component) => sum + resolveEffectiveLoad(component, set), 0);
  }

  const entered = set.weightKg ?? 0;

  switch (exercise.loadType) {
    case "barbell":
    case "machine":
    case "cable":
      return entered;
    case "dumbbell":
      // §3.2: entered weight is always per implement; limbsLoaded (not an
      // implicit unilateral-driven x2) is what scales it.
      return entered * exercise.limbsLoaded;
    case "bodyweight":
      return set.bodyweightKg * requireLeverage(exercise);
    case "weighted_bodyweight":
      return set.bodyweightKg * requireLeverage(exercise) + entered;
    case "assisted":
      return Math.max(0, set.bodyweightKg * requireLeverage(exercise) - entered);
    case "time":
      return requireIntensity(exercise);
    case "distance":
      return set.bodyweightKg * requireLeverage(exercise);
  }
}

// The "quantity" a set's effective load is multiplied by to get volume:
// reps for weight/bodyweight exercises, seconds for time-based, metres
// (scaled) for distance-based. Unilateral sets log reps/duration per side,
// so the total work performed is double what was entered — for all three
// quantity kinds, not just reps.
function quantity(exercise: Exercise, set: LoggedSet): number {
  const sides = exercise.unilateral ? 2 : 1;

  if (exercise.loadType === "time") {
    return (set.durationSec ?? 0) * sides;
  }
  if (exercise.loadType === "distance") {
    return (set.distanceM ?? 0) * DISTANCE_SCALE * sides;
  }
  return (set.reps ?? 0) * sides;
}

export function computeSetVolume(exercise: Exercise, set: LoggedSet): number {
  if (exercise.components) {
    // Each component computes its own load x its own quantity (reps, secs,
    // or scaled metres) independently, then the set's total volume is
    // their sum — this is what lets a compound mix reps-based and
    // time-based movements in one LoggedSet.
    return Math.max(0, exercise.components.reduce((sum, component) => sum + computeSetVolume(component, set), 0));
  }

  const load = resolveEffectiveLoad(exercise, set);
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
