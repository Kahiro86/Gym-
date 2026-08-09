// Tier-1/Tier-2 muscle registry — Layer 1's canonical muscle taxonomy.
// v2 §3.3: shared with Layer 2 (heatmap), which is why tauDays/volumeFloor
// (heatmap-only concerns in v1) live on the same Muscle record as the XP
// engine's own groupId/views. There is exactly one muscle taxonomy now,
// not a domain one and a heatmap one.

export type GroupId = "chest" | "back" | "shoulders" | "arms" | "core" | "legs";

export type MuscleId =
  | "chestClavicular"
  | "chestSternal"
  | "lats"
  | "rhomboids"
  | "lowerBack"
  | "trapUpper"
  | "trapMid"
  | "trapLower"
  | "deltAnterior"
  | "deltLateral"
  | "deltPosterior"
  | "biceps"
  | "tricepsLong"
  | "tricepsLateral"
  | "forearms"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves"
  | "abductors"
  | "adductors"
  | "neck";

export type BodyView = "front" | "back";

export interface Muscle {
  id: MuscleId;
  displayName: string;
  groupId: GroupId;
  views: BodyView[];
  tauDays: number; // recovery decay constant, Layer 2 heatmap
  volumeFloor: number; // minimum viable weekly volume, Layer 2 heatmap
}

// §3.3: "Do not author 24 distinct values up front." Same reasoning
// extends to volumeFloor, which is likewise marked TBD/tunable.
export const DEFAULT_TAU_DAYS = 3.0;
export const DEFAULT_VOLUME_FLOOR = 500;

const FRONT: BodyView[] = ["front"];
const BACK: BodyView[] = ["back"];
const BOTH: BodyView[] = ["front", "back"];

export const MUSCLES: Muscle[] = [
  { id: "chestClavicular", displayName: "Upper Chest", groupId: "chest", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "chestSternal", displayName: "Chest", groupId: "chest", views: FRONT, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "lats", displayName: "Lats", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "rhomboids", displayName: "Rhomboids", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "lowerBack", displayName: "Lower Back", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "trapUpper", displayName: "Upper Traps", groupId: "back", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "trapMid", displayName: "Mid Traps", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
  { id: "trapLower", displayName: "Lower Traps", groupId: "back", views: BACK, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
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
  // §3.3: neck must have real catalog entries or it can't render anything
  // but permanently unranked — catalog.ts seeds neck-curl/neck-extension.
  { id: "neck", displayName: "Neck", groupId: "back", views: BOTH, tauDays: DEFAULT_TAU_DAYS, volumeFloor: DEFAULT_VOLUME_FLOOR },
];

export const MUSCLE_IDS: MuscleId[] = MUSCLES.map((m) => m.id);

export interface Group {
  id: GroupId;
  displayName: string;
}

export const GROUPS: Group[] = [
  { id: "chest", displayName: "Chest" },
  { id: "back", displayName: "Back" },
  { id: "shoulders", displayName: "Shoulders" },
  { id: "arms", displayName: "Arms" },
  { id: "core", displayName: "Core" },
  { id: "legs", displayName: "Legs" },
];

const MUSCLE_BY_ID = new Map(MUSCLES.map((m) => [m.id, m]));

export function getMuscle(id: MuscleId): Muscle {
  const muscle = MUSCLE_BY_ID.get(id);
  if (!muscle) {
    throw new Error(`Unknown muscle id: ${id}`);
  }
  return muscle;
}

export function musclesInGroup(groupId: GroupId): Muscle[] {
  return MUSCLES.filter((m) => m.groupId === groupId);
}

export function musclesInView(view: BodyView): Muscle[] {
  return MUSCLES.filter((m) => m.views.includes(view));
}
