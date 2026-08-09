import type { Exercise, MuscleContribution } from "../domain/types.js";
import type { HeatmapMuscleId } from "./registry.js";

// Re-authors every exercise's contribution weights onto the split-head
// taxonomy. Rather than hand-writing ~107 independent contribution arrays,
// this derives them from the existing (proven, shares-sum-to-1) Layer 1
// catalog by splitting the four muscles that got heads (shoulders, chest,
// traps, triceps) according to the exercise's movement pattern — pressing
// vs pulling vs isolation — and passing every other muscle through
// unchanged. This keeps the split methodology consistent and auditable
// instead of 100+ independently-guessed numbers, while still giving each
// exercise a considered, pattern-specific split rather than one global
// default (see SPLIT_OVERRIDES below).

export interface HeatmapContribution {
  muscle: HeatmapMuscleId;
  weight: number; // 0-1, heat-intensity contribution (§3)
  primary: boolean; // primary mover -> drives the binary "trained" flag (§3)
}

// A contribution below this share was a stabilizer/secondary mover for the
// *original* (pre-split) muscle, not a primary one. Tunable constant, not
// physiology — mirrors the spec's own treatment of tau_days/volume_floor.
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
interface TrapsSplit {
  upper: number;
  mid: number;
  lower: number;
}
interface TricepsSplit {
  long: number;
  lateralMedial: number;
}

const DEFAULT_DELT_SPLIT: DeltSplit = { anterior: 0.5, lateral: 0.3, posterior: 0.2 };
const DEFAULT_PEC_SPLIT: PecSplit = { clavicular: 0.35, sternal: 0.65 };
const DEFAULT_TRAPS_SPLIT: TrapsSplit = { upper: 0.4, mid: 0.35, lower: 0.25 };
const DEFAULT_TRICEPS_SPLIT: TricepsSplit = { long: 0.5, lateralMedial: 0.5 };

// Named archetypes so each override below reads as "this exercise is a
// horizontal press" rather than a bare number tuple.
const DELT_HORIZONTAL_PRESS: DeltSplit = { anterior: 0.75, lateral: 0.2, posterior: 0.05 };
const DELT_OVERHEAD_PRESS: DeltSplit = { anterior: 0.65, lateral: 0.3, posterior: 0.05 };
const DELT_PULL: DeltSplit = { anterior: 0.05, lateral: 0.15, posterior: 0.8 };
const DELT_LATERAL_RAISE: DeltSplit = { anterior: 0.1, lateral: 0.85, posterior: 0.05 };
const DELT_REAR_ISOLATION: DeltSplit = { anterior: 0.05, lateral: 0.15, posterior: 0.8 };

const PEC_INCLINE: PecSplit = { clavicular: 0.65, sternal: 0.35 };
const PEC_DECLINE: PecSplit = { clavicular: 0.15, sternal: 0.85 };
const PEC_NARROW_GRIP: PecSplit = { clavicular: 0.25, sternal: 0.75 };

const TRAPS_SHRUG: TrapsSplit = { upper: 0.85, mid: 0.1, lower: 0.05 };
const TRAPS_OVERHEAD_PRESS: TrapsSplit = { upper: 0.75, mid: 0.15, lower: 0.1 };
const TRAPS_ISOMETRIC_CARRY: TrapsSplit = { upper: 0.7, mid: 0.2, lower: 0.1 };
const TRAPS_SCAPULAR_RETRACTION: TrapsSplit = { upper: 0.2, mid: 0.4, lower: 0.4 };

const TRICEPS_OVERHEAD_STRETCH: TricepsSplit = { long: 0.65, lateralMedial: 0.35 };
const TRICEPS_ELBOW_TUCKED: TricepsSplit = { long: 0.3, lateralMedial: 0.7 };

interface SplitOverride {
  delt?: DeltSplit;
  pec?: PecSplit;
  traps?: TrapsSplit;
  triceps?: TricepsSplit;
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

const PULL_IDS = [
  "barbell-row",
  "t-bar-row",
  "seated-cable-row",
  "lat-pulldown",
  "pull-up",
  "chin-up",
  "weighted-pull-up",
  "assisted-pull-up",
  "inverted-row",
  "single-arm-dumbbell-row",
  "typewriter-pull-up",
];

// Movement-pattern-derived splits. Exercises not listed here fall back to
// the archetype-neutral DEFAULT_*_SPLIT constants above.
const SPLIT_OVERRIDES: Record<string, SplitOverride> = {
  ...Object.fromEntries(HORIZONTAL_PRESS_IDS.map((id) => [id, { delt: DELT_HORIZONTAL_PRESS }])),
  ...Object.fromEntries(OVERHEAD_PRESS_IDS.map((id) => [id, { delt: DELT_OVERHEAD_PRESS, traps: TRAPS_OVERHEAD_PRESS, triceps: TRICEPS_OVERHEAD_STRETCH }])),
  ...Object.fromEntries(PULL_IDS.map((id) => [id, { delt: DELT_PULL }])),

  "lateral-raise": { delt: DELT_LATERAL_RAISE, traps: { upper: 0.8, mid: 0.15, lower: 0.05 } },
  "face-pull": { delt: DELT_REAR_ISOLATION, traps: TRAPS_SCAPULAR_RETRACTION },
  "barbell-shrug": { traps: TRAPS_SHRUG },
  "dumbbell-shrug": { traps: TRAPS_SHRUG },
  deadlift: { traps: TRAPS_ISOMETRIC_CARRY },
  superman: { traps: TRAPS_ISOMETRIC_CARRY },
  "farmers-carry": { traps: TRAPS_ISOMETRIC_CARRY },

  "incline-barbell-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_INCLINE },
  "incline-dumbbell-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_INCLINE },
  "incline-pushup": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_INCLINE },
  "pike-pushup": { delt: DELT_OVERHEAD_PRESS, traps: TRAPS_OVERHEAD_PRESS, triceps: TRICEPS_OVERHEAD_STRETCH, pec: PEC_INCLINE },
  "handstand-pushup": { delt: DELT_OVERHEAD_PRESS, traps: TRAPS_OVERHEAD_PRESS, triceps: TRICEPS_OVERHEAD_STRETCH, pec: { clavicular: 0.7, sternal: 0.3 } },
  "decline-barbell-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_DECLINE },
  "decline-pushup": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_DECLINE },
  "close-grip-bench-press": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_NARROW_GRIP, triceps: TRICEPS_ELBOW_TUCKED },
  "diamond-pushup": { delt: DELT_HORIZONTAL_PRESS, pec: PEC_NARROW_GRIP, triceps: TRICEPS_ELBOW_TUCKED },

  "triceps-pushdown": { triceps: TRICEPS_ELBOW_TUCKED },
  "skull-crusher": { triceps: TRICEPS_ELBOW_TUCKED },
  "overhead-triceps-extension": { triceps: TRICEPS_OVERHEAD_STRETCH },
  dip: { delt: DELT_HORIZONTAL_PRESS, triceps: TRICEPS_ELBOW_TUCKED },
  "bench-dip": { delt: DELT_HORIZONTAL_PRESS, triceps: TRICEPS_ELBOW_TUCKED },

  "barbell-clean-and-press": { delt: DELT_OVERHEAD_PRESS, traps: TRAPS_ISOMETRIC_CARRY, triceps: TRICEPS_OVERHEAD_STRETCH },
  "muscle-up": { delt: { anterior: 0.4, lateral: 0.3, posterior: 0.3 }, pec: PEC_NARROW_GRIP, triceps: TRICEPS_ELBOW_TUCKED },
  "bear-crawl": { delt: { anterior: 0.6, lateral: 0.3, posterior: 0.1 } },
  "ab-wheel-rollout": { delt: { anterior: 0.7, lateral: 0.2, posterior: 0.1 } },
};

function primaryFlag(share: number): boolean {
  return share >= PRIMARY_MOVER_SHARE_THRESHOLD;
}

function splitContribution(exerciseId: string, contribution: MuscleContribution): HeatmapContribution[] {
  const override = SPLIT_OVERRIDES[exerciseId];
  const primary = primaryFlag(contribution.share);
  const share = contribution.share;

  switch (contribution.muscle) {
    case "shoulders": {
      const s = override?.delt ?? DEFAULT_DELT_SPLIT;
      return [
        { muscle: "deltAnterior", weight: share * s.anterior, primary },
        { muscle: "deltLateral", weight: share * s.lateral, primary },
        { muscle: "deltPosterior", weight: share * s.posterior, primary },
      ];
    }
    case "chest": {
      const s = override?.pec ?? DEFAULT_PEC_SPLIT;
      return [
        { muscle: "pecClavicular", weight: share * s.clavicular, primary },
        { muscle: "pecSternal", weight: share * s.sternal, primary },
      ];
    }
    case "traps": {
      const s = override?.traps ?? DEFAULT_TRAPS_SPLIT;
      return [
        { muscle: "trapsUpper", weight: share * s.upper, primary },
        { muscle: "trapsMid", weight: share * s.mid, primary },
        { muscle: "trapsLower", weight: share * s.lower, primary },
      ];
    }
    case "triceps": {
      const s = override?.triceps ?? DEFAULT_TRICEPS_SPLIT;
      return [
        { muscle: "tricepsLong", weight: share * s.long, primary },
        { muscle: "tricepsLateral", weight: share * s.lateralMedial, primary },
      ];
    }
    default:
      // Muscles the spec says stay atomic (back, lowerBack, neck, biceps,
      // forearms, abs, obliques, glutes, quads, hamstrings, calves,
      // abductors, adductors) pass straight through with the same id.
      return [{ muscle: contribution.muscle as HeatmapMuscleId, weight: share, primary }];
  }
}

function mergeContributions(contributions: HeatmapContribution[]): HeatmapContribution[] {
  const totals = new Map<HeatmapMuscleId, { weight: number; primary: boolean }>();
  for (const c of contributions) {
    const current = totals.get(c.muscle) ?? { weight: 0, primary: false };
    totals.set(c.muscle, { weight: current.weight + c.weight, primary: current.primary || c.primary });
  }
  return Array.from(totals.entries()).map(([muscle, v]) => ({ muscle, weight: v.weight, primary: v.primary }));
}

export function computeHeatmapContributions(exercise: Exercise): HeatmapContribution[] {
  if (exercise.components) {
    // Equal-weighted blend across components, matching compound.ts's
    // default emphasis (compounds don't carry per-component emphasis on
    // the Exercise object itself, so this is the best info available here).
    const perComponent = exercise.components.map((c) => computeHeatmapContributions(c));
    const scaled = perComponent.flatMap((contributions) =>
      contributions.map((c) => ({ ...c, weight: c.weight / perComponent.length }))
    );
    return mergeContributions(scaled);
  }

  return mergeContributions(exercise.muscles.flatMap((c) => splitContribution(exercise.id, c)));
}
