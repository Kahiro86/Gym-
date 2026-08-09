export * from "./types.js";
export type { Muscle, Group, GroupId } from "./muscles.js";
export { MUSCLES, GROUPS, DEFAULT_TAU_DAYS, DEFAULT_VOLUME_FLOOR, getMuscle, musclesInGroup, musclesInView } from "./muscles.js";
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
export { resolveEffectiveLoad, computeSetVolume, DISTANCE_SCALE } from "./load.js";
export { computeSessionXp, streakMultiplier, XP_CONSTANT } from "./xp.js";
export { xpRequiredForLevel, levelFromTotalXp, rankForMuscleXp } from "./progression.js";
export type { LevelProgress } from "./progression.js";
export { detectPrs, recordSetIntoHistory } from "./prs.js";
export { detectBodyweightPrs, recordBodyweightIntoHistory, BODYWEIGHT_PR_SUBJECT } from "./bodyweight.js";
export { aggregateMuscleXp, aggregateMuscleVolume, aggregateSessionTotals } from "./aggregate.js";
export type { SessionTotals } from "./aggregate.js";
export type { CardioModalityId, CardioModality, CardioLog } from "./cardio.js";
export { CARDIO_MODALITIES, CARDIO_CAP, getCardioModality, computeCardioVolume, computeCardioMuscleVolume } from "./cardio.js";
export {
  ACHIEVEMENTS,
  getAchievementDefinition,
  evaluateAchievements,
  resolveAchievementRewards,
  emptyPrCounts,
} from "./achievements.js";
export type {
  Reward,
  PlayerStats,
  AchievementDefinition,
  UnlockedAchievement,
  AchievementUnlockResult,
} from "./achievements.js";
