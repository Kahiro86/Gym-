// Tier-1/Tier-2 muscle registry for the heatmap & analytics feature.
//
// This is intentionally a SEPARATE taxonomy from domain/types.ts's MuscleId
// (which drives XP/rank/achievements — "Layer 4" in this spec's numbering).
// The heatmap spec explicitly wants split heads (delts, pecs, traps,
// triceps) that the gamification layer has no reason to care about, and the
// spec is explicit: "No Layer 4 / gamification coupling yet." Keeping them
// separate means neither system's tuning constants leak into the other.

export type BodyView = "front" | "back";

export type HeatmapGroupId = "shoulders" | "chest" | "back" | "arms" | "core" | "legs";

export type HeatmapMuscleId =
  | "pecClavicular"
  | "pecSternal"
  | "back"
  | "lowerBack"
  | "trapsUpper"
  | "trapsMid"
  | "trapsLower"
  | "neck"
  | "deltAnterior"
  | "deltLateral"
  | "deltPosterior"
  | "biceps"
  | "tricepsLong"
  | "tricepsLateral" // grouped lateral + medial heads, per spec §2
  | "forearms"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves"
  | "abductors"
  | "adductors";

export interface HeatmapGroupDefinition {
  id: HeatmapGroupId;
  displayName: string;
}

export const HEATMAP_GROUPS: HeatmapGroupDefinition[] = [
  { id: "shoulders", displayName: "Shoulders" },
  { id: "chest", displayName: "Chest" },
  { id: "back", displayName: "Back" },
  { id: "arms", displayName: "Arms" },
  { id: "core", displayName: "Core" },
  { id: "legs", displayName: "Legs" },
];

export interface HeatmapMuscleDefinition {
  id: HeatmapMuscleId;
  displayName: string;
  groupId: HeatmapGroupId;
  views: BodyView[];
  tauDays: number;
  volumeFloor: number;
}

// §7: "Do not invent 24 distinct values up front... treat as tunable
// product constants." Same reasoning extends to volume_floor, which the
// spec marks TBD — one placeholder constant beats 23 invented ones.
export const DEFAULT_TAU_DAYS = 3.0;
export const DEFAULT_VOLUME_FLOOR = 500;

const FRONT: BodyView[] = ["front"];
const BACK: BodyView[] = ["back"];
const BOTH: BodyView[] = ["front", "back"];

export const HEATMAP_MUSCLES: HeatmapMuscleDefinition[] = [
  { id: "pecClavicular", displayName: "Upper Chest", groupId: "chest", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "pecSternal", displayName: "Chest", groupId: "chest", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "back", displayName: "Back", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "lowerBack", displayName: "Lower Back", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "trapsUpper", displayName: "Upper Traps", groupId: "back", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "trapsMid", displayName: "Mid Traps", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "trapsLower", displayName: "Lower Traps", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "neck", displayName: "Neck", groupId: "back", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "deltAnterior", displayName: "Front Delt", groupId: "shoulders", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "deltLateral", displayName: "Side Delt", groupId: "shoulders", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "deltPosterior", displayName: "Rear Delt", groupId: "shoulders", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "biceps", displayName: "Biceps", groupId: "arms", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "tricepsLong", displayName: "Triceps (Long Head)", groupId: "arms", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "tricepsLateral", displayName: "Triceps", groupId: "arms", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "forearms", displayName: "Forearms", groupId: "arms", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "abs", displayName: "Abs", groupId: "core", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "obliques", displayName: "Obliques", groupId: "core", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "glutes", displayName: "Glutes", groupId: "legs", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "quads", displayName: "Quads", groupId: "legs", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "hamstrings", displayName: "Hamstrings", groupId: "legs", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "calves", displayName: "Calves", groupId: "legs", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "abductors", displayName: "Abductors", groupId: "legs", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "adductors", displayName: "Adductors", groupId: "legs", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
];

const MUSCLE_BY_ID = new Map(HEATMAP_MUSCLES.map((m) => [m.id, m]));

export function getHeatmapMuscle(id: HeatmapMuscleId): HeatmapMuscleDefinition {
  const muscle = MUSCLE_BY_ID.get(id);
  if (!muscle) {
    throw new Error(`Unknown heatmap muscle id: ${id}`);
  }
  return muscle;
}

export function musclesInGroup(groupId: HeatmapGroupId): HeatmapMuscleDefinition[] {
  return HEATMAP_MUSCLES.filter((m) => m.groupId === groupId);
}

export function musclesInView(view: BodyView): HeatmapMuscleDefinition[] {
  return HEATMAP_MUSCLES.filter((m) => m.views.includes(view));
}
