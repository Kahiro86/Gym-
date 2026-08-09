import type { Exercise, LoggedSet } from "./types.js";

export function resolveEffectiveLoad(
  exercise: Exercise,
  set: LoggedSet,
  bodyweightKg: number
): number {
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
  if (exercise.loadType === "time") {
    return set.durationSec ?? 0;
  }
  if (exercise.loadType === "distance") {
    return set.distanceM ?? 0;
  }
  const reps = set.reps ?? 0;
  return exercise.unilateral ? reps * 2 : reps;
}

export function computeSetVolume(
  exercise: Exercise,
  set: LoggedSet,
  bodyweightKg: number
): number {
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
