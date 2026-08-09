export type { BodyView, HeatmapGroupId, HeatmapMuscleId, HeatmapGroupDefinition, HeatmapMuscleDefinition } from "./registry.js";
export { HEATMAP_GROUPS, HEATMAP_MUSCLES, DEFAULT_TAU_DAYS, DEFAULT_VOLUME_FLOOR, getHeatmapMuscle, musclesInGroup, musclesInView } from "./registry.js";

export type { HeatmapContribution } from "./muscleWeights.js";
export { computeHeatmapContributions } from "./muscleWeights.js";

export type { CardioModality, CardioModalityWeight, CardioConversion, CardioSessionInput } from "./cardio.js";
export { CARDIO_MODALITY_MAP, CARDIO_CONVERSION, CARDIO_CAP, computeCardioMuscleVolume } from "./cardio.js";

export { computeSetMuscleVolumes, primaryMusclesTouched } from "./volume.js";

export type { MuscleWeekRollupRow, MuscleRollupStore, HeatmapSessionInput } from "./store.js";
export { InMemoryMuscleRollupStore, weekStartFor, addWeeks, applySessionToRollup, recomputeWeekRollup } from "./store.js";

export type { RecencyMapEntry, WeeklyMuscleEntry, WeeklyGroupEntry, WeeklyMap, DiffMuscleEntry, DiffView } from "./views.js";
export { computeRecencyMap, computeWeeklyMap, computeDiffView, findUnmappedMuscles } from "./views.js";
