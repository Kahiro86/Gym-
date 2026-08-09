// Layer 1 domain types. Pure data — no behavior lives here.

export type LoadType =
  | "barbell"
  | "machine"
  | "dumbbell"
  | "cable"
  | "bodyweight"
  | "weighted_bodyweight"
  | "assisted"
  | "time"
  | "distance";

export type MuscleId =
  | "chest"
  | "back"
  | "lowerBack"
  | "traps"
  | "neck"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves"
  | "abductors"
  | "adductors";

export const MUSCLE_IDS: MuscleId[] = [
  "chest",
  "back",
  "lowerBack",
  "traps",
  "neck",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "obliques",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
  "abductors",
  "adductors",
];

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "bench"
  | "pull-up-bar"
  | "dip-bar"
  | "kettlebell"
  | "bar"
  | "none";

export interface MuscleContribution {
  muscle: MuscleId;
  share: number; // 0-1; all shares for one exercise sum to 1.0
}

export interface Exercise {
  id: string;
  name: string;
  aliases: string[];
  loadType: LoadType;
  leverageFactor?: number; // required for bodyweight / weighted_bodyweight / assisted
  intensityFactor?: number; // required for time / distance
  muscles: MuscleContribution[];
  equipment: Equipment[];
  unilateral: boolean; // if true, reps/duration are logged per side
  referenceVolume: number;
}

export interface LoggedSet {
  exerciseId: string;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  distanceM?: number;
  rpe?: number; // optional, 6-10, collected but not fed into XP (see spec §9.2)
  timestamp: number;
}

export interface RepsAtLoad {
  loadKg: number;
  reps: number;
}

export interface ExerciseHistory {
  maxWeightKg: number;
  maxVolumeSingleSet: number;
  repsAtLoad: RepsAtLoad[];
}

export function emptyExerciseHistory(): ExerciseHistory {
  return { maxWeightKg: 0, maxVolumeSingleSet: 0, repsAtLoad: [] };
}

export interface HistoryContext {
  exerciseHistory: Record<string, ExerciseHistory>;
  isFirstSessionOfDay: boolean;
  completesWeeklyTarget: boolean;
  streakWeeks: number;
}

export interface SessionInput {
  sets: LoggedSet[];
  bodyweightKg: number;
  history: HistoryContext;
}

export interface XpComponent {
  label: string;
  amount: number;
  reason: string;
}

export interface XpBreakdown {
  total: number;
  base: number;
  components: XpComponent[];
}

export type PrType = "weight" | "rep" | "volume";

export interface Pr {
  type: PrType;
  exerciseId: string;
  value: number;
  previousBest: number;
}

export interface SessionXpResult {
  total: number;
  setBreakdowns: XpBreakdown[];
  muscleXp: Record<MuscleId, number>;
  prs: Pr[];
  sessionBonusComponents: XpComponent[];
  updatedExerciseHistory: Record<string, ExerciseHistory>;
}

export type Rank = "F" | "E" | "D" | "C" | "B" | "A" | "S";
export type RankOrUnranked = Rank | "unranked";
