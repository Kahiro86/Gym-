// Layer 2's own muscle taxonomy was retired in v2 — Layer 1 now authors
// exercise.muscles at head level directly, with tauDays/volumeFloor/groupId
// living on the same domain/muscles.ts registry. Re-exported here so
// Layer 2 consumers don't also need a direct domain/ import for them.
export type { Muscle, MuscleId, GroupId, Group, BodyView } from "../domain/muscles.js";
export { MUSCLES, GROUPS, DEFAULT_TAU_DAYS, DEFAULT_VOLUME_FLOOR, getMuscle, musclesInGroup, musclesInView } from "../domain/muscles.js";

export type { CardioModalityId, CardioModality, CardioLog } from "../domain/cardio.js";
export { CARDIO_MODALITIES, CARDIO_CAP, getCardioModality, computeCardioVolume, computeCardioMuscleVolume } from "../domain/cardio.js";

export { computeSetMuscleVolumes, primaryMusclesTouched } from "./volume.js";

export type { MuscleWeekRollupRow, MuscleRollupStore, HeatmapSessionInput } from "./store.js";
export { InMemoryMuscleRollupStore, weekStartFor, addWeeks, applySessionToRollup, recomputeWeekRollup } from "./store.js";

export type { RecencyMapEntry, WeeklyMuscleEntry, WeeklyGroupEntry, WeeklyMap, DiffMuscleEntry, DiffView } from "./views.js";
export { computeRecencyMap, computeWeeklyMap, computeDiffView, findUnmappedMuscles } from "./views.js";
