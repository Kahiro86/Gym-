import { getExercise as getSeedExercise } from "./catalog.js";
import type { Exercise, MuscleContribution } from "./types.js";
import type { MuscleId } from "./muscles.js";

// A compound exercise is a derived Exercise built from 2+ existing exercises
// performed together as one movement (e.g. a barbell complex, or a mixed
// combo like a bodyweight pushup + a barbell row). Its `components` array
// (see types.ts) lets load.ts recurse into each component's own effective
// load and volume independently and sum the results — so components can
// freely mix load types, since each one reads only the LoggedSet fields its
// own loadType needs. `loadType`/`leverageFactor`/`intensityFactor` on the
// compound itself are left as advisory-only display hints and are never
// used for computation once `components` is set.

export interface CompoundComponentSpec {
  exerciseId: string;
  emphasis?: number; // relative weight for muscle-share blending only; default 1 (equal)
}

type ComponentInput = string | CompoundComponentSpec;

const compoundRegistry = new Map<string, Exercise>();

function lookupAny(id: string): Exercise | undefined {
  return compoundRegistry.get(id) ?? getSeedExercise(id);
}

export function createCompoundExercise(
  id: string,
  name: string,
  components: ComponentInput[],
  options: { aliases?: string[] } = {}
): Exercise {
  if (lookupAny(id)) {
    throw new Error(`Exercise id "${id}" is already taken`);
  }

  const specs: CompoundComponentSpec[] = components.map((c) =>
    typeof c === "string" ? { exerciseId: c, emphasis: 1 } : { exerciseId: c.exerciseId, emphasis: c.emphasis ?? 1 }
  );

  if (specs.length < 2) {
    throw new Error("A compound exercise needs at least 2 component exercises");
  }
  if (new Set(specs.map((s) => s.exerciseId)).size !== specs.length) {
    throw new Error("A compound exercise cannot repeat the same component exercise");
  }

  const components_ = specs.map((spec) => {
    const exercise = lookupAny(spec.exerciseId);
    if (!exercise) {
      throw new Error(`Unknown component exercise id: ${spec.exerciseId}`);
    }
    if (spec.emphasis !== undefined && spec.emphasis <= 0) {
      throw new Error(`Component "${spec.exerciseId}" emphasis must be positive`);
    }
    return { exercise, emphasis: spec.emphasis ?? 1 };
  });

  const compound: Exercise = {
    id,
    name,
    aliases: options.aliases ?? [],
    loadType: components_[0]!.exercise.loadType,
    limbsLoaded: components_[0]!.exercise.limbsLoaded,
    muscles: blendMuscleContributions(components_),
    equipment: dedupe(components_.flatMap((c) => c.exercise.equipment)),
    unilateral: components_.some((c) => c.exercise.unilateral),
    referenceVolume: components_.reduce((sum, c) => sum + c.exercise.referenceVolume, 0),
    // A compound needs at least as much rest as its most demanding component.
    defaultRestSeconds: Math.max(...components_.map((c) => c.exercise.defaultRestSeconds)),
    components: components_.map((c) => c.exercise),
  };

  compoundRegistry.set(id, compound);
  return compound;
}

function blendMuscleContributions(components: Array<{ exercise: Exercise; emphasis: number }>): MuscleContribution[] {
  const totals = new Map<MuscleId, { share: number; primaryMover: boolean }>();
  const totalEmphasis = components.reduce((sum, c) => sum + c.emphasis, 0);

  for (const { exercise, emphasis } of components) {
    for (const contribution of exercise.muscles) {
      const weightedShare = (contribution.share * emphasis) / totalEmphasis;
      const current = totals.get(contribution.muscle) ?? { share: 0, primaryMover: false };
      totals.set(contribution.muscle, {
        share: current.share + weightedShare,
        primaryMover: current.primaryMover || contribution.primaryMover,
      });
    }
  }

  return Array.from(totals.entries()).map(([muscle, v]) => ({ muscle, share: v.share, primaryMover: v.primaryMover }));
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function getCompoundExercise(id: string): Exercise | undefined {
  return compoundRegistry.get(id);
}

export function listCompoundExercises(): Exercise[] {
  return Array.from(compoundRegistry.values());
}

export function clearCompoundRegistry(): void {
  compoundRegistry.clear();
}
