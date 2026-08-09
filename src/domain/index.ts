export * from "./types.js";
export { EXERCISE_CATALOG } from "./catalog.js";
export { getExercise, requireExercise, allExercises } from "./registry.js";
export {
  createCompoundExercise,
  getCompoundExercise,
  listCompoundExercises,
  clearCompoundRegistry,
} from "./compound.js";
export type { CompoundComponentSpec } from "./compound.js";
export { searchExercises } from "./search.js";
export type { ExerciseSearchOptions } from "./search.js";
export { resolveEffectiveLoad, computeSetVolume } from "./load.js";
export {
  computeSetXp,
  computeSessionXp,
  diminishingMultiplierFor,
  streakMultiplier,
  XP_CONSTANT,
  WEEKLY_TARGET_BONUS,
} from "./xp.js";
export type { SetXpContext } from "./xp.js";
export { xpRequiredForLevel, levelFromTotalXp, rankForMuscleXp } from "./progression.js";
export type { LevelProgress } from "./progression.js";
export { detectPrs, recordSetIntoHistory } from "./prs.js";
export { aggregateMuscleXp, aggregateSessionTotals } from "./aggregate.js";
export type { SessionTotals } from "./aggregate.js";
