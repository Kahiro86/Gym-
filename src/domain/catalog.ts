import type { Equipment, Exercise, LoadType, MuscleContribution } from "./types.js";
import type { MuscleId } from "./muscles.js";

// ~107 seeded exercises, authored at head-level muscle granularity (v2
// §3.3/§3.4). Rather than hand-typing several hundred head-level shares
// directly, exercises are authored here at a coarser, easier-to-review
// granularity (chest/back/shoulders/traps/triceps as single entries) plus a
// movement-pattern tag, then expanded into head-level MuscleContribution[]
// with primaryMover by splitContribution() below — auditable and
// consistent instead of 400+ independently-guessed numbers. This is the
// exact same methodology the heatmap module used to use on top of Layer 1;
// now that Layer 1 authors at head-level directly, Layer 2 just reads
// exercise.muscles (see heatmap/muscleWeights.ts).

type CoarseMuscleId =
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

interface CoarseContribution {
  muscle: CoarseMuscleId;
  share: number;
}

interface RawExercise {
  id: string;
  name: string;
  aliases: string[];
  loadType: LoadType;
  limbsLoaded: 1 | 2;
  unilateral: boolean;
  leverageFactor?: number;
  intensityFactor?: number;
  muscles: CoarseContribution[];
  equipment: Equipment[];
  referenceVolume: number;
  defaultRestSeconds: number;
}

const RAW_EXERCISES: RawExercise[] = [
  // ---- Chest ----
  {
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    aliases: ["bench press", "bb bench"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.6 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["barbell", "bench"],
    referenceVolume: 320,
    defaultRestSeconds: 180,
  },
  {
    id: "incline-barbell-bench-press",
    name: "Incline Barbell Bench Press",
    aliases: ["incline bench"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.55 },
      { muscle: "shoulders", share: 0.25 },
      { muscle: "triceps", share: 0.2 },
    ],
    equipment: ["barbell", "bench"],
    referenceVolume: 280,
    defaultRestSeconds: 180,
  },
  {
    id: "decline-barbell-bench-press",
    name: "Decline Barbell Bench Press",
    aliases: ["decline bench"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.65 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "shoulders", share: 0.1 },
    ],
    equipment: ["barbell", "bench"],
    referenceVolume: 320,
    defaultRestSeconds: 180,
  },
  {
    id: "dumbbell-bench-press",
    name: "Dumbbell Bench Press",
    aliases: ["db bench"],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.58 },
      { muscle: "triceps", share: 0.24 },
      { muscle: "shoulders", share: 0.18 },
    ],
    equipment: ["dumbbell", "bench"],
    referenceVolume: 240,
    defaultRestSeconds: 180,
  },
  {
    id: "incline-dumbbell-bench-press",
    name: "Incline Dumbbell Bench Press",
    aliases: ["incline db bench"],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.55 },
      { muscle: "shoulders", share: 0.25 },
      { muscle: "triceps", share: 0.2 },
    ],
    equipment: ["dumbbell", "bench"],
    referenceVolume: 220,
    defaultRestSeconds: 180,
  },
  {
    id: "machine-chest-press",
    name: "Machine Chest Press",
    aliases: ["chest press machine"],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.62 },
      { muscle: "triceps", share: 0.23 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["machine"],
    referenceVolume: 300,
    defaultRestSeconds: 180,
  },
  {
    id: "cable-fly",
    name: "Cable Fly",
    aliases: ["cable crossover"],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "chest", share: 0.8 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["cable"],
    referenceVolume: 180,
    defaultRestSeconds: 60,
  },
  {
    id: "pushup",
    name: "Push-up",
    aliases: ["press up", "pushups"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.64,
    muscles: [
      { muscle: "chest", share: 0.55 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2000,
    defaultRestSeconds: 180,
  },
  {
    id: "incline-pushup",
    name: "Incline Push-up",
    aliases: ["incline pushups"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.55,
    muscles: [
      { muscle: "chest", share: 0.5 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "shoulders", share: 0.25 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2200,
    defaultRestSeconds: 180,
  },
  {
    id: "dip",
    name: "Dip",
    aliases: ["chest dip", "triceps dip"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.95,
    muscles: [
      { muscle: "chest", share: 0.4 },
      { muscle: "triceps", share: 0.4 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["dip-bar"],
    referenceVolume: 850,
    defaultRestSeconds: 180,
  },

  // ---- Back ----
  {
    id: "deadlift",
    name: "Deadlift",
    aliases: ["conventional deadlift"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "back", share: 0.3 },
      { muscle: "lowerBack", share: 0.2 },
      { muscle: "glutes", share: 0.25 },
      { muscle: "hamstrings", share: 0.2 },
      { muscle: "traps", share: 0.05 },
    ],
    equipment: ["barbell"],
    referenceVolume: 400,
    defaultRestSeconds: 180,
  },
  {
    id: "barbell-row",
    name: "Barbell Row",
    aliases: ["bent over row"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "lowerBack", share: 0.15 },
      { muscle: "biceps", share: 0.15 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["barbell"],
    referenceVolume: 350,
    defaultRestSeconds: 180,
  },
  {
    id: "t-bar-row",
    name: "T-Bar Row",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "back", share: 0.6 },
      { muscle: "biceps", share: 0.2 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["machine"],
    referenceVolume: 320,
    defaultRestSeconds: 180,
  },
  {
    id: "seated-cable-row",
    name: "Seated Cable Row",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "biceps", share: 0.25 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["cable"],
    referenceVolume: 300,
    defaultRestSeconds: 180,
  },
  {
    id: "lat-pulldown",
    name: "Lat Pulldown",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "back", share: 0.65 },
      { muscle: "biceps", share: 0.25 },
      { muscle: "shoulders", share: 0.1 },
    ],
    equipment: ["cable"],
    referenceVolume: 300,
    defaultRestSeconds: 180,
  },
  {
    id: "pull-up",
    name: "Pull-up",
    aliases: ["pullups"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "biceps", share: 0.3 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 700,
    defaultRestSeconds: 180,
  },
  {
    id: "chin-up",
    name: "Chin-up",
    aliases: ["chinups"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.45 },
      { muscle: "biceps", share: 0.4 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 650,
    defaultRestSeconds: 180,
  },
  {
    id: "weighted-pull-up",
    name: "Weighted Pull-up",
    aliases: [],
    loadType: "weighted_bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "biceps", share: 0.3 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["pull-up-bar", "bar"],
    referenceVolume: 750,
    defaultRestSeconds: 180,
  },
  {
    id: "assisted-pull-up",
    name: "Assisted Pull-up",
    aliases: [],
    loadType: "assisted",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "biceps", share: 0.3 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["pull-up-bar", "machine"],
    referenceVolume: 650,
    defaultRestSeconds: 180,
  },
  {
    id: "inverted-row",
    name: "Inverted Row",
    aliases: ["bodyweight row"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.6,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "biceps", share: 0.25 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["bar"],
    referenceVolume: 1100,
    defaultRestSeconds: 180,
  },
  {
    id: "single-arm-dumbbell-row",
    name: "Single-Arm Dumbbell Row",
    aliases: ["db row"],
    loadType: "dumbbell",
    limbsLoaded: 1,
    unilateral: true,
    muscles: [
      { muscle: "back", share: 0.55 },
      { muscle: "biceps", share: 0.2 },
      { muscle: "shoulders", share: 0.15 },
      { muscle: "lowerBack", share: 0.1 },
    ],
    equipment: ["dumbbell", "bench"],
    referenceVolume: 720,
    defaultRestSeconds: 180,
  },
  {
    id: "good-morning",
    name: "Good Morning",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "hamstrings", share: 0.4 },
      { muscle: "lowerBack", share: 0.35 },
      { muscle: "glutes", share: 0.25 },
    ],
    equipment: ["barbell"],
    referenceVolume: 200,
    defaultRestSeconds: 180,
  },
  {
    id: "back-extension",
    name: "Back Extension",
    aliases: ["hyperextension"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.4,
    muscles: [
      { muscle: "lowerBack", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.15 },
    ],
    equipment: ["machine"],
    referenceVolume: 900,
    defaultRestSeconds: 60,
  },
  {
    id: "superman",
    name: "Superman",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.3,
    muscles: [
      { muscle: "lowerBack", share: 0.6 },
      { muscle: "glutes", share: 0.25 },
      { muscle: "traps", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1000,
    defaultRestSeconds: 60,
  },

  // ---- Shoulders ----
  {
    id: "overhead-press",
    name: "Overhead Press",
    aliases: ["ohp", "military press"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "shoulders", share: 0.65 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "traps", share: 0.1 },
    ],
    equipment: ["barbell"],
    referenceVolume: 220,
    defaultRestSeconds: 180,
  },
  {
    id: "seated-dumbbell-press",
    name: "Seated Dumbbell Press",
    aliases: ["db shoulder press"],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "shoulders", share: 0.65 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "traps", share: 0.1 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 200,
    defaultRestSeconds: 180,
  },
  {
    id: "machine-shoulder-press",
    name: "Machine Shoulder Press",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "shoulders", share: 0.65 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "traps", share: 0.1 },
    ],
    equipment: ["machine"],
    referenceVolume: 240,
    defaultRestSeconds: 180,
  },
  {
    id: "lateral-raise",
    name: "Lateral Raise",
    aliases: ["side raise"],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "shoulders", share: 0.9 },
      { muscle: "traps", share: 0.1 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 140,
    defaultRestSeconds: 60,
  },
  {
    id: "pike-pushup",
    name: "Pike Push-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.6,
    muscles: [
      { muscle: "shoulders", share: 0.55 },
      { muscle: "triceps", share: 0.3 },
      { muscle: "chest", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1400,
    defaultRestSeconds: 180,
  },
  {
    id: "handstand-pushup",
    name: "Handstand Push-up",
    aliases: ["hspu"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.9,
    muscles: [
      { muscle: "shoulders", share: 0.6 },
      { muscle: "triceps", share: 0.3 },
      { muscle: "chest", share: 0.1 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 500,
    defaultRestSeconds: 180,
  },

  // ---- Traps ----
  {
    id: "barbell-shrug",
    name: "Barbell Shrug",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "traps", share: 0.9 },
      { muscle: "forearms", share: 0.1 },
    ],
    equipment: ["barbell"],
    referenceVolume: 360,
    defaultRestSeconds: 60,
  },
  {
    id: "dumbbell-shrug",
    name: "Dumbbell Shrug",
    aliases: [],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "traps", share: 0.9 },
      { muscle: "forearms", share: 0.1 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 300,
    defaultRestSeconds: 60,
  },
  {
    id: "face-pull",
    name: "Face Pull",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "traps", share: 0.35 },
      { muscle: "shoulders", share: 0.4 },
      { muscle: "back", share: 0.25 },
    ],
    equipment: ["cable"],
    referenceVolume: 150,
    defaultRestSeconds: 60,
  },

  // ---- Neck ----
  {
    id: "neck-curl",
    name: "Neck Curl",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "neck", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 100,
    defaultRestSeconds: 60,
  },
  {
    id: "neck-extension",
    name: "Neck Extension",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "neck", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 100,
    defaultRestSeconds: 60,
  },

  // ---- Biceps ----
  {
    id: "barbell-curl",
    name: "Barbell Curl",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "biceps", share: 0.85 },
      { muscle: "forearms", share: 0.15 },
    ],
    equipment: ["barbell"],
    referenceVolume: 180,
    defaultRestSeconds: 60,
  },
  {
    id: "dumbbell-curl",
    name: "Dumbbell Curl",
    aliases: [],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "biceps", share: 0.85 },
      { muscle: "forearms", share: 0.15 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 160,
    defaultRestSeconds: 60,
  },
  {
    id: "hammer-curl",
    name: "Hammer Curl",
    aliases: [],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: false,
    muscles: [
      { muscle: "biceps", share: 0.65 },
      { muscle: "forearms", share: 0.35 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 160,
    defaultRestSeconds: 60,
  },
  {
    id: "cable-curl",
    name: "Cable Curl",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "biceps", share: 0.85 },
      { muscle: "forearms", share: 0.15 },
    ],
    equipment: ["cable"],
    referenceVolume: 180,
    defaultRestSeconds: 60,
  },
  {
    id: "preacher-curl",
    name: "Preacher Curl",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "biceps", share: 0.9 },
      { muscle: "forearms", share: 0.1 },
    ],
    equipment: ["machine"],
    referenceVolume: 200,
    defaultRestSeconds: 60,
  },

  // ---- Triceps ----
  {
    id: "triceps-pushdown",
    name: "Triceps Pushdown",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "triceps", share: 0.9 },
      { muscle: "forearms", share: 0.1 },
    ],
    equipment: ["cable"],
    referenceVolume: 200,
    defaultRestSeconds: 60,
  },
  {
    id: "skull-crusher",
    name: "Skull Crusher",
    aliases: ["lying triceps extension"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "triceps", share: 0.85 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["barbell", "bench"],
    referenceVolume: 160,
    defaultRestSeconds: 60,
  },
  {
    id: "overhead-triceps-extension",
    name: "Overhead Triceps Extension",
    aliases: [],
    loadType: "dumbbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "triceps", share: 0.85 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 160,
    defaultRestSeconds: 60,
  },
  {
    id: "close-grip-bench-press",
    name: "Close-Grip Bench Press",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "triceps", share: 0.5 },
      { muscle: "chest", share: 0.35 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["barbell", "bench"],
    referenceVolume: 280,
    defaultRestSeconds: 180,
  },
  {
    id: "bench-dip",
    name: "Bench Dip",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.7,
    muscles: [
      { muscle: "triceps", share: 0.6 },
      { muscle: "chest", share: 0.25 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["bench"],
    referenceVolume: 1400,
    defaultRestSeconds: 180,
  },

  // ---- Forearms ----
  {
    id: "wrist-curl",
    name: "Wrist Curl",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "forearms", share: 1.0 }],
    equipment: ["barbell"],
    referenceVolume: 100,
    defaultRestSeconds: 60,
  },
  {
    id: "farmers-carry",
    name: "Farmer's Carry",
    aliases: ["farmer's walk"],
    loadType: "distance",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.5,
    muscles: [
      { muscle: "forearms", share: 0.4 },
      { muscle: "traps", share: 0.25 },
      { muscle: "abs", share: 0.15 },
      { muscle: "quads", share: 0.2 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 1600,
    defaultRestSeconds: 180,
  },
  {
    id: "dead-hang",
    name: "Dead Hang",
    aliases: [],
    loadType: "time",
    limbsLoaded: 1,
    unilateral: false,
    intensityFactor: 3,
    muscles: [
      { muscle: "forearms", share: 0.7 },
      { muscle: "back", share: 0.3 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 120,
    defaultRestSeconds: 60,
  },

  // ---- Abs ----
  {
    id: "crunch",
    name: "Crunch",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.3,
    muscles: [{ muscle: "abs", share: 1.0 }],
    equipment: ["bodyweight"],
    referenceVolume: 1400,
    defaultRestSeconds: 60,
  },
  {
    id: "sit-up",
    name: "Sit-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.35,
    muscles: [
      { muscle: "abs", share: 0.85 },
      { muscle: "obliques", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1500,
    defaultRestSeconds: 60,
  },
  {
    id: "hanging-leg-raise",
    name: "Hanging Leg Raise",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.55,
    muscles: [
      { muscle: "abs", share: 0.75 },
      { muscle: "obliques", share: 0.15 },
      { muscle: "quads", share: 0.1 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 900,
    defaultRestSeconds: 60,
  },
  {
    id: "cable-crunch",
    name: "Cable Crunch",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "abs", share: 1.0 }],
    equipment: ["cable"],
    referenceVolume: 220,
    defaultRestSeconds: 60,
  },
  {
    id: "plank",
    name: "Plank",
    aliases: [],
    loadType: "time",
    limbsLoaded: 1,
    unilateral: false,
    intensityFactor: 5,
    muscles: [
      { muscle: "abs", share: 0.6 },
      { muscle: "obliques", share: 0.2 },
      { muscle: "lowerBack", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 300,
    defaultRestSeconds: 60,
  },
  {
    id: "hollow-hold",
    name: "Hollow Hold",
    aliases: [],
    loadType: "time",
    limbsLoaded: 1,
    unilateral: false,
    intensityFactor: 4,
    muscles: [
      { muscle: "abs", share: 0.8 },
      { muscle: "obliques", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 180,
    defaultRestSeconds: 60,
  },
  {
    id: "ab-wheel-rollout",
    name: "Ab Wheel Rollout",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.5,
    muscles: [
      { muscle: "abs", share: 0.7 },
      { muscle: "obliques", share: 0.1 },
      { muscle: "lowerBack", share: 0.1 },
      { muscle: "shoulders", share: 0.1 },
    ],
    equipment: ["none"],
    referenceVolume: 800,
    defaultRestSeconds: 60,
  },
  {
    id: "mountain-climber",
    name: "Mountain Climber",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.35,
    muscles: [
      { muscle: "abs", share: 0.55 },
      { muscle: "obliques", share: 0.15 },
      { muscle: "quads", share: 0.3 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1700,
    defaultRestSeconds: 60,
  },

  // ---- Obliques ----
  {
    id: "russian-twist",
    name: "Russian Twist",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.3,
    muscles: [
      { muscle: "obliques", share: 0.7 },
      { muscle: "abs", share: 0.3 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1200,
    defaultRestSeconds: 60,
  },
  {
    id: "side-plank",
    name: "Side Plank",
    aliases: [],
    loadType: "time",
    limbsLoaded: 1,
    unilateral: true,
    intensityFactor: 4,
    muscles: [
      { muscle: "obliques", share: 0.75 },
      { muscle: "abs", share: 0.15 },
      { muscle: "shoulders", share: 0.1 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 160,
    defaultRestSeconds: 60,
  },
  {
    id: "cable-woodchopper",
    name: "Cable Woodchopper",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: true,
    muscles: [
      { muscle: "obliques", share: 0.7 },
      { muscle: "abs", share: 0.2 },
      { muscle: "shoulders", share: 0.1 },
    ],
    equipment: ["cable"],
    referenceVolume: 200,
    defaultRestSeconds: 60,
  },

  // ---- Glutes ----
  {
    id: "barbell-hip-thrust",
    name: "Barbell Hip Thrust",
    aliases: ["hip thrust"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "glutes", share: 0.7 },
      { muscle: "hamstrings", share: 0.2 },
      { muscle: "quads", share: 0.1 },
    ],
    equipment: ["barbell"],
    referenceVolume: 400,
    defaultRestSeconds: 180,
  },
  {
    id: "glute-bridge",
    name: "Glute Bridge",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.35,
    muscles: [
      { muscle: "glutes", share: 0.75 },
      { muscle: "hamstrings", share: 0.25 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1500,
    defaultRestSeconds: 60,
  },
  {
    id: "bulgarian-split-squat",
    name: "Bulgarian Split Squat",
    aliases: ["rear foot elevated split squat"],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: true,
    muscles: [
      { muscle: "glutes", share: 0.4 },
      { muscle: "quads", share: 0.4 },
      { muscle: "hamstrings", share: 0.1 },
      { muscle: "abductors", share: 0.1 },
    ],
    equipment: ["dumbbell", "bench"],
    referenceVolume: 480,
    defaultRestSeconds: 180,
  },
  {
    id: "donkey-kick",
    name: "Donkey Kick",
    aliases: ["glute kickback"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.3,
    muscles: [
      { muscle: "glutes", share: 0.8 },
      { muscle: "hamstrings", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1300,
    defaultRestSeconds: 60,
  },

  // ---- Quads ----
  {
    id: "back-squat",
    name: "Back Squat",
    aliases: ["barbell squat"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "quads", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.1 },
      { muscle: "lowerBack", share: 0.05 },
    ],
    equipment: ["barbell"],
    referenceVolume: 400,
    defaultRestSeconds: 180,
  },
  {
    id: "front-squat",
    name: "Front Squat",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "quads", share: 0.65 },
      { muscle: "glutes", share: 0.25 },
      { muscle: "lowerBack", share: 0.1 },
    ],
    equipment: ["barbell"],
    referenceVolume: 320,
    defaultRestSeconds: 180,
  },
  {
    id: "leg-press",
    name: "Leg Press",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "quads", share: 0.6 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.1 },
    ],
    equipment: ["machine"],
    referenceVolume: 900,
    defaultRestSeconds: 180,
  },
  {
    id: "leg-extension",
    name: "Leg Extension",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "quads", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 300,
    defaultRestSeconds: 60,
  },
  {
    id: "walking-lunge",
    name: "Walking Lunge",
    aliases: ["lunges"],
    loadType: "dumbbell",
    limbsLoaded: 2,
    unilateral: true,
    muscles: [
      { muscle: "quads", share: 0.5 },
      { muscle: "glutes", share: 0.35 },
      { muscle: "hamstrings", share: 0.1 },
      { muscle: "abductors", share: 0.05 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 400,
    defaultRestSeconds: 180,
  },
  {
    id: "goblet-squat",
    name: "Goblet Squat",
    aliases: [],
    loadType: "dumbbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "quads", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.1 },
      { muscle: "abductors", share: 0.05 },
    ],
    equipment: ["dumbbell"],
    referenceVolume: 240,
    defaultRestSeconds: 180,
  },
  {
    id: "pistol-squat",
    name: "Pistol Squat",
    aliases: ["single-leg squat"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.85,
    muscles: [
      { muscle: "quads", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.1 },
      { muscle: "abductors", share: 0.05 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 700,
    defaultRestSeconds: 180,
  },
  {
    id: "bodyweight-squat",
    name: "Bodyweight Squat",
    aliases: ["air squat"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.7,
    muscles: [
      { muscle: "quads", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.1 },
      { muscle: "abductors", share: 0.05 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2400,
    defaultRestSeconds: 180,
  },

  // ---- Hamstrings ----
  {
    id: "romanian-deadlift",
    name: "Romanian Deadlift",
    aliases: ["rdl"],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "hamstrings", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "lowerBack", share: 0.15 },
    ],
    equipment: ["barbell"],
    referenceVolume: 380,
    defaultRestSeconds: 180,
  },
  {
    id: "leg-curl",
    name: "Leg Curl",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "hamstrings", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 280,
    defaultRestSeconds: 60,
  },
  {
    id: "nordic-curl",
    name: "Nordic Curl",
    aliases: ["nordic hamstring curl"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.6,
    muscles: [
      { muscle: "hamstrings", share: 0.85 },
      { muscle: "glutes", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 480,
    defaultRestSeconds: 60,
  },
  {
    id: "glute-ham-raise",
    name: "Glute Ham Raise",
    aliases: ["ghr"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.55,
    muscles: [
      { muscle: "hamstrings", share: 0.7 },
      { muscle: "glutes", share: 0.3 },
    ],
    equipment: ["machine"],
    referenceVolume: 660,
    defaultRestSeconds: 60,
  },

  // ---- Calves ----
  {
    id: "standing-calf-raise",
    name: "Standing Calf Raise",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "calves", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 500,
    defaultRestSeconds: 60,
  },
  {
    id: "seated-calf-raise",
    name: "Seated Calf Raise",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "calves", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 400,
    defaultRestSeconds: 60,
  },
  {
    id: "bodyweight-calf-raise",
    name: "Bodyweight Calf Raise",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.35,
    muscles: [{ muscle: "calves", share: 1.0 }],
    equipment: ["bodyweight"],
    referenceVolume: 1400,
    defaultRestSeconds: 60,
  },
  {
    id: "single-leg-calf-raise",
    name: "Single-Leg Calf Raise",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.35,
    muscles: [{ muscle: "calves", share: 1.0 }],
    equipment: ["bodyweight"],
    referenceVolume: 1400,
    defaultRestSeconds: 60,
  },

  // ---- Abductors / Adductors ----
  {
    id: "cable-hip-abduction",
    name: "Cable Hip Abduction",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: true,
    muscles: [
      { muscle: "abductors", share: 0.9 },
      { muscle: "glutes", share: 0.1 },
    ],
    equipment: ["cable"],
    referenceVolume: 150,
    defaultRestSeconds: 60,
  },
  {
    id: "machine-hip-abduction",
    name: "Machine Hip Abduction",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "abductors", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 300,
    defaultRestSeconds: 60,
  },
  {
    id: "cable-hip-adduction",
    name: "Cable Hip Adduction",
    aliases: [],
    loadType: "cable",
    limbsLoaded: 1,
    unilateral: true,
    muscles: [
      { muscle: "adductors", share: 0.9 },
      { muscle: "glutes", share: 0.1 },
    ],
    equipment: ["cable"],
    referenceVolume: 150,
    defaultRestSeconds: 60,
  },
  {
    id: "machine-hip-adduction",
    name: "Machine Hip Adduction",
    aliases: [],
    loadType: "machine",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [{ muscle: "adductors", share: 1.0 }],
    equipment: ["machine"],
    referenceVolume: 300,
    defaultRestSeconds: 60,
  },

  // ---- Full body / carries ----
  {
    id: "barbell-clean-and-press",
    name: "Clean and Press",
    aliases: [],
    loadType: "barbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "shoulders", share: 0.3 },
      { muscle: "quads", share: 0.2 },
      { muscle: "glutes", share: 0.2 },
      { muscle: "traps", share: 0.2 },
      { muscle: "triceps", share: 0.1 },
    ],
    equipment: ["barbell"],
    referenceVolume: 300,
    defaultRestSeconds: 180,
  },
  {
    id: "kettlebell-swing",
    name: "Kettlebell Swing",
    aliases: ["kb swing"],
    loadType: "dumbbell",
    limbsLoaded: 1,
    unilateral: false,
    muscles: [
      { muscle: "glutes", share: 0.4 },
      { muscle: "hamstrings", share: 0.3 },
      { muscle: "lowerBack", share: 0.15 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["kettlebell"],
    referenceVolume: 240,
    defaultRestSeconds: 180,
  },
  {
    id: "sled-push",
    name: "Sled Push",
    aliases: [],
    loadType: "distance",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.6,
    muscles: [
      { muscle: "quads", share: 0.4 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.15 },
      { muscle: "calves", share: 0.15 },
    ],
    equipment: ["machine"],
    referenceVolume: 960,
    defaultRestSeconds: 180,
  },
  {
    id: "burpee",
    name: "Burpee",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.45,
    muscles: [
      { muscle: "chest", share: 0.2 },
      { muscle: "shoulders", share: 0.15 },
      { muscle: "quads", share: 0.3 },
      { muscle: "abs", share: 0.2 },
      { muscle: "glutes", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1800,
    defaultRestSeconds: 180,
  },

  // ---- More bodyweight ----
  {
    id: "wide-grip-pushup",
    name: "Wide-Grip Push-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.66,
    muscles: [
      { muscle: "chest", share: 0.6 },
      { muscle: "triceps", share: 0.2 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2100,
    defaultRestSeconds: 180,
  },
  {
    id: "diamond-pushup",
    name: "Diamond Push-up",
    aliases: ["close-grip pushup", "triangle pushup"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.6,
    muscles: [
      { muscle: "triceps", share: 0.5 },
      { muscle: "chest", share: 0.35 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1700,
    defaultRestSeconds: 180,
  },
  {
    id: "decline-pushup",
    name: "Decline Push-up",
    aliases: ["feet elevated pushup"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.74,
    muscles: [
      { muscle: "chest", share: 0.45 },
      { muscle: "shoulders", share: 0.35 },
      { muscle: "triceps", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1900,
    defaultRestSeconds: 180,
  },
  {
    id: "archer-pushup",
    name: "Archer Push-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.7,
    muscles: [
      { muscle: "chest", share: 0.55 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 900,
    defaultRestSeconds: 180,
  },
  {
    id: "spiderman-pushup",
    name: "Spiderman Push-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.66,
    muscles: [
      { muscle: "chest", share: 0.45 },
      { muscle: "triceps", share: 0.2 },
      { muscle: "shoulders", share: 0.15 },
      { muscle: "obliques", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1900,
    defaultRestSeconds: 180,
  },
  {
    id: "single-arm-pushup",
    name: "Single-Arm Push-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.7,
    muscles: [
      { muscle: "chest", share: 0.55 },
      { muscle: "triceps", share: 0.3 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 350,
    defaultRestSeconds: 180,
  },
  {
    id: "clap-pushup",
    name: "Clap Push-up",
    aliases: ["plyo pushup"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.7,
    muscles: [
      { muscle: "chest", share: 0.5 },
      { muscle: "triceps", share: 0.3 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 900,
    defaultRestSeconds: 180,
  },
  {
    id: "jump-squat",
    name: "Jump Squat",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.75,
    muscles: [
      { muscle: "quads", share: 0.55 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "calves", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1800,
    defaultRestSeconds: 180,
  },
  {
    id: "sumo-squat",
    name: "Sumo Squat",
    aliases: ["wide stance squat"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.7,
    muscles: [
      { muscle: "quads", share: 0.45 },
      { muscle: "glutes", share: 0.35 },
      { muscle: "adductors", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2300,
    defaultRestSeconds: 180,
  },
  {
    id: "curtsy-lunge",
    name: "Curtsy Lunge",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.55,
    muscles: [
      { muscle: "glutes", share: 0.45 },
      { muscle: "quads", share: 0.35 },
      { muscle: "adductors", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1500,
    defaultRestSeconds: 180,
  },
  {
    id: "reverse-lunge",
    name: "Reverse Lunge",
    aliases: ["bodyweight reverse lunge"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.55,
    muscles: [
      { muscle: "quads", share: 0.5 },
      { muscle: "glutes", share: 0.35 },
      { muscle: "hamstrings", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1600,
    defaultRestSeconds: 180,
  },
  {
    id: "single-leg-glute-bridge",
    name: "Single-Leg Glute Bridge",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.35,
    muscles: [
      { muscle: "glutes", share: 0.8 },
      { muscle: "hamstrings", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1300,
    defaultRestSeconds: 60,
  },
  {
    id: "broad-jump",
    name: "Broad Jump",
    aliases: ["standing long jump"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.8,
    muscles: [
      { muscle: "quads", share: 0.45 },
      { muscle: "glutes", share: 0.35 },
      { muscle: "calves", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 700,
    defaultRestSeconds: 180,
  },
  {
    id: "jumping-lunge",
    name: "Jumping Lunge",
    aliases: ["split jump"],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.78,
    muscles: [
      { muscle: "quads", share: 0.5 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "calves", share: 0.2 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 1400,
    defaultRestSeconds: 180,
  },
  {
    id: "high-knees",
    name: "High Knees",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.35,
    muscles: [
      { muscle: "quads", share: 0.4 },
      { muscle: "abs", share: 0.35 },
      { muscle: "calves", share: 0.25 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2200,
    defaultRestSeconds: 60,
  },
  {
    id: "bear-crawl",
    name: "Bear Crawl",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 0.45,
    muscles: [
      { muscle: "shoulders", share: 0.3 },
      { muscle: "abs", share: 0.3 },
      { muscle: "quads", share: 0.25 },
      { muscle: "chest", share: 0.15 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 2000,
    defaultRestSeconds: 180,
  },
  {
    id: "commando-pull-up",
    name: "Commando Pull-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.5 },
      { muscle: "biceps", share: 0.3 },
      { muscle: "obliques", share: 0.2 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 650,
    defaultRestSeconds: 180,
  },
  {
    id: "typewriter-pull-up",
    name: "Typewriter Pull-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.45 },
      { muscle: "biceps", share: 0.35 },
      { muscle: "shoulders", share: 0.2 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 500,
    defaultRestSeconds: 180,
  },
  {
    id: "muscle-up",
    name: "Muscle-up",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: false,
    leverageFactor: 1.0,
    muscles: [
      { muscle: "back", share: 0.35 },
      { muscle: "chest", share: 0.25 },
      { muscle: "triceps", share: 0.25 },
      { muscle: "shoulders", share: 0.15 },
    ],
    equipment: ["pull-up-bar"],
    referenceVolume: 550,
    defaultRestSeconds: 180,
  },
  {
    id: "shrimp-squat",
    name: "Shrimp Squat",
    aliases: [],
    loadType: "bodyweight",
    limbsLoaded: 1,
    unilateral: true,
    leverageFactor: 0.8,
    muscles: [
      { muscle: "quads", share: 0.5 },
      { muscle: "glutes", share: 0.3 },
      { muscle: "hamstrings", share: 0.15 },
      { muscle: "adductors", share: 0.05 },
    ],
    equipment: ["bodyweight"],
    referenceVolume: 600,
    defaultRestSeconds: 180,
  },
];

// ---- Splitting: coarse -> head-level, movement-pattern-derived ----
// Same methodology heatmap/muscleWeights.ts used to use on top of this
// catalog; now it happens once, here, and the result is the authoritative
// per-exercise data everything else (XP, PRs, heatmap) reads directly.

const PRIMARY_MOVER_SHARE_THRESHOLD = 0.3;

interface DeltSplit {
  anterior: number;
  lateral: number;
  posterior: number;
}
interface PecSplit {
  clavicular: number;
  sternal: number;
}
interface TrapSplit {
  upper: number;
  mid: number;
  lower: number;
}
interface TricepsSplit {
  long: number;
  lateral: number;
}
interface BackSplit {
  lats: number;
  rhomboids: number;
}

const DEFAULT_DELT_SPLIT: DeltSplit = { anterior: 0.5, lateral: 0.3, posterior: 0.2 };
const DEFAULT_PEC_SPLIT: PecSplit = { clavicular: 0.35, sternal: 0.65 };
const DEFAULT_TRAP_SPLIT: TrapSplit = { upper: 0.4, mid: 0.35, lower: 0.25 };
const DEFAULT_TRICEPS_SPLIT: TricepsSplit = { long: 0.5, lateral: 0.5 };
const DEFAULT_BACK_SPLIT: BackSplit = { lats: 0.5, rhomboids: 0.5 };

const DELT_HORIZONTAL_PRESS: DeltSplit = { anterior: 0.75, lateral: 0.2, posterior: 0.05 };
const DELT_OVERHEAD_PRESS: DeltSplit = { anterior: 0.65, lateral: 0.3, posterior: 0.05 };
const DELT_PULL: DeltSplit = { anterior: 0.05, lateral: 0.15, posterior: 0.8 };
const DELT_LATERAL_RAISE: DeltSplit = { anterior: 0.1, lateral: 0.85, posterior: 0.05 };

const PEC_INCLINE: PecSplit = { clavicular: 0.65, sternal: 0.35 };
const PEC_DECLINE: PecSplit = { clavicular: 0.15, sternal: 0.85 };
const PEC_NARROW_GRIP: PecSplit = { clavicular: 0.25, sternal: 0.75 };

const TRAP_SHRUG: TrapSplit = { upper: 0.85, mid: 0.1, lower: 0.05 };
const TRAP_OVERHEAD_PRESS: TrapSplit = { upper: 0.75, mid: 0.15, lower: 0.1 };
const TRAP_ISOMETRIC_CARRY: TrapSplit = { upper: 0.7, mid: 0.2, lower: 0.1 };
const TRAP_SCAPULAR_RETRACTION: TrapSplit = { upper: 0.2, mid: 0.4, lower: 0.4 };

const TRICEPS_OVERHEAD_STRETCH: TricepsSplit = { long: 0.65, lateral: 0.35 };
const TRICEPS_ELBOW_TUCKED: TricepsSplit = { long: 0.3, lateral: 0.7 };

const BACK_VERTICAL_PULL: BackSplit = { lats: 0.75, rhomboids: 0.25 };
const BACK_HORIZONTAL_PULL: BackSplit = { lats: 0.45, rhomboids: 0.55 };

interface SplitOverride {
  delt?: DeltSplit;
  pec?: PecSplit;
  trap?: TrapSplit;
  triceps?: TricepsSplit;
  back?: BackSplit;
}

const HORIZONTAL_PRESS_IDS = [
  "barbell-bench-press",
  "incline-barbell-bench-press",
  "decline-barbell-bench-press",
  "dumbbell-bench-press",
  "incline-dumbbell-bench-press",
  "machine-chest-press",
  "cable-fly",
  "pushup",
  "incline-pushup",
  "decline-pushup",
  "wide-grip-pushup",
  "diamond-pushup",
  "archer-pushup",
  "spiderman-pushup",
  "single-arm-pushup",
  "clap-pushup",
  "dip",
  "bench-dip",
  "close-grip-bench-press",
  "burpee",
];
const OVERHEAD_PRESS_IDS = ["overhead-press", "seated-dumbbell-press", "machine-shoulder-press", "pike-pushup", "handstand-pushup"];
const VERTICAL_PULL_IDS = ["pull-up", "chin-up", "lat-pulldown", "weighted-pull-up", "assisted-pull-up", "commando-pull-up", "typewriter-pull-up"];
const HORIZONTAL_PULL_IDS = ["barbell-row", "t-bar-row", "seated-cable-row", "inverted-row", "single-arm-dumbbell-row"];

const SPLIT_OVERRIDES: Record<string, SplitOverride> = {
  ...Object.fromEntries(HORIZONTAL_PRESS_IDS.map((id) => [id, { delt: DELT_HORIZONTAL_PRESS }])),
  ...Object.fromEntries(OVERHEAD_PRESS_IDS.map((id) => [id, { delt: DELT_OVERHEAD_PRESS, trap: TRAP_OVERHEAD_PRESS, triceps: TRICEPS_OVERHEAD_STRETCH }])),
  ...Object.fromEntries(VERTICAL_PULL_IDS.map((id) => [id, { delt: DELT_PULL, back: BACK_VERTICAL_PULL }])),
  ...Object.fromEntries(HORIZONTAL_PULL_IDS.map((id) => [id, { delt: DELT_PULL, back: BACK_HORIZONTAL_PULL }])),

  "lateral-raise": { delt: DELT_LATERAL_RAISE, trap: { upper: 0.8, mid: 0.15, lower: 0.05 } },
  "face-pull": { delt: DELT_PULL, trap: TRAP_SCAPULAR_RETRACTION, back: { lats: 0.2, rhomboids: 0.8 } },
  "barbell-shrug": { trap: TRAP_SHRUG },
  "dumbbell-shrug": { trap: TRAP_SHRUG },
  deadlift: { trap: TRAP_ISOMETRIC_CARRY },
  superman: { trap: TRAP_ISOMETRIC_CARRY },
  "farmers-carry": { trap: TRAP_ISOMETRIC_CARRY },
  "dead-hang": { back: { lats: 0.8, rhomboids: 0.2 } },

  "incline-barbell-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_INCLINE },
  "incline-dumbbell-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_INCLINE },
  "incline-pushup": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_INCLINE },
  "pike-pushup": { delt: DELT_OVERHEAD_PRESS, trap: TRAP_OVERHEAD_PRESS, triceps: TRICEPS_OVERHEAD_STRETCH, pec: PEC_INCLINE },
  "handstand-pushup": { delt: DELT_OVERHEAD_PRESS, trap: TRAP_OVERHEAD_PRESS, triceps: TRICEPS_OVERHEAD_STRETCH, pec: { clavicular: 0.7, sternal: 0.3 } },
  "decline-barbell-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_DECLINE },
  "decline-pushup": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_DECLINE },
  "close-grip-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_NARROW_GRIP, triceps: TRICEPS_ELBOW_TUCKED },
  "diamond-pushup": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_NARROW_GRIP, triceps: TRICEPS_ELBOW_TUCKED },

  "triceps-pushdown": { triceps: TRICEPS_ELBOW_TUCKED },
  "skull-crusher": { triceps: TRICEPS_ELBOW_TUCKED },
  "overhead-triceps-extension": { triceps: TRICEPS_OVERHEAD_STRETCH },
  dip: { delt: DELT_HORIZONTAL_PRESS, triceps: TRICEPS_ELBOW_TUCKED },
  "bench-dip": { delt: DELT_HORIZONTAL_PRESS, triceps: TRICEPS_ELBOW_TUCKED },

  "barbell-clean-and-press": { delt: DELT_OVERHEAD_PRESS, trap: TRAP_ISOMETRIC_CARRY, triceps: TRICEPS_OVERHEAD_STRETCH },
  "muscle-up": { delt: { anterior: 0.4, lateral: 0.3, posterior: 0.3 }, pec: PEC_NARROW_GRIP, triceps: TRICEPS_ELBOW_TUCKED, back: { lats: 0.7, rhomboids: 0.3 } },
  "bear-crawl": { delt: { anterior: 0.6, lateral: 0.3, posterior: 0.1 } },
  "ab-wheel-rollout": { delt: { anterior: 0.7, lateral: 0.2, posterior: 0.1 } },
};

function primaryFlag(share: number): boolean {
  return share >= PRIMARY_MOVER_SHARE_THRESHOLD;
}

function splitContribution(exerciseId: string, contribution: CoarseContribution): MuscleContribution[] {
  const override = SPLIT_OVERRIDES[exerciseId];
  const primaryMover = primaryFlag(contribution.share);
  const share = contribution.share;

  switch (contribution.muscle) {
    case "shoulders": {
      const s = override?.delt ?? DEFAULT_DELT_SPLIT;
      return [
        { muscle: "deltAnterior", share: share * s.anterior, primaryMover },
        { muscle: "deltLateral", share: share * s.lateral, primaryMover },
        { muscle: "deltPosterior", share: share * s.posterior, primaryMover },
      ];
    }
    case "chest": {
      const s = override?.pec ?? DEFAULT_PEC_SPLIT;
      return [
        { muscle: "chestClavicular", share: share * s.clavicular, primaryMover },
        { muscle: "chestSternal", share: share * s.sternal, primaryMover },
      ];
    }
    case "traps": {
      const s = override?.trap ?? DEFAULT_TRAP_SPLIT;
      return [
        { muscle: "trapUpper", share: share * s.upper, primaryMover },
        { muscle: "trapMid", share: share * s.mid, primaryMover },
        { muscle: "trapLower", share: share * s.lower, primaryMover },
      ];
    }
    case "triceps": {
      const s = override?.triceps ?? DEFAULT_TRICEPS_SPLIT;
      return [
        { muscle: "tricepsLong", share: share * s.long, primaryMover },
        { muscle: "tricepsLateral", share: share * s.lateral, primaryMover },
      ];
    }
    case "back": {
      const s = override?.back ?? DEFAULT_BACK_SPLIT;
      return [
        { muscle: "lats", share: share * s.lats, primaryMover },
        { muscle: "rhomboids", share: share * s.rhomboids, primaryMover },
      ];
    }
    default:
      // Muscles that stay atomic (lowerBack, neck, biceps, forearms, abs,
      // obliques, glutes, quads, hamstrings, calves, abductors, adductors)
      // pass straight through with the same id.
      return [{ muscle: contribution.muscle as MuscleId, share, primaryMover }];
  }
}

function mergeContributions(contributions: MuscleContribution[]): MuscleContribution[] {
  const totals = new Map<MuscleId, { share: number; primaryMover: boolean }>();
  for (const c of contributions) {
    const current = totals.get(c.muscle) ?? { share: 0, primaryMover: false };
    totals.set(c.muscle, { share: current.share + c.share, primaryMover: current.primaryMover || c.primaryMover });
  }
  return Array.from(totals.entries()).map(([muscle, v]) => ({ muscle, share: v.share, primaryMover: v.primaryMover }));
}

function expandExercise(raw: RawExercise): Exercise {
  const { muscles, ...rest } = raw;
  return {
    ...rest,
    muscles: mergeContributions(muscles.flatMap((c) => splitContribution(raw.id, c))),
  };
}

export const EXERCISE_CATALOG: Exercise[] = RAW_EXERCISES.map(expandExercise);

const CATALOG_BY_ID: Map<string, Exercise> = new Map(EXERCISE_CATALOG.map((exercise) => [exercise.id, exercise]));

export function getExercise(id: string): Exercise | undefined {
  return CATALOG_BY_ID.get(id);
}

export function requireExercise(id: string): Exercise {
  const exercise = CATALOG_BY_ID.get(id);
  if (!exercise) {
    throw new Error(`Unknown exercise id: ${id}`);
  }
  return exercise;
}
