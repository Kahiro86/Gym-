import { getExercise as getSeedExercise } from "./catalog.js";
import type { Exercise, LoadType, MuscleContribution, MuscleId } from "./types.js";

// A compound exercise is a derived Exercise built from 2+ existing exercises
// performed together as one movement (e.g. a barbell complex, or a bodyweight
// combo like squat+pushup+jump). It reuses the same effective-load formula as
// its components, so it plugs into load.ts/xp.ts/prs.ts unmodified — see
// registry.ts for how it's made visible to computeSessionXp and search.
//
// This only works because, for a shared loadType, each component's
// contribution to volume is additive: e.g. for bodyweight, effectiveLoad =
// bodyweightKg * leverage, so summing leverageFactor across components and
// applying the *same* reps/duration to all of them reproduces the sum of
// each component's own volume exactly.

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

  const loadType: LoadType = components_[0]!.exercise.loadType;
  for (const { exercise } of components_) {
    if (exercise.loadType !== loadType) {
      throw new Error(
        `Compound exercises require every component to share the same load type; got "${loadType}" and "${exercise.loadType}" (${exercise.id})`
      );
    }
  }

  const compound: Exercise = {
    id,
    name,
    aliases: options.aliases ?? [],
    loadType,
    muscles: blendMuscleContributions(components_),
    equipment: dedupe(components_.flatMap((c) => c.exercise.equipment)),
    unilateral: components_.some((c) => c.exercise.unilateral),
    referenceVolume: components_.reduce((sum, c) => sum + c.exercise.referenceVolume, 0),
  };

  if (loadType === "bodyweight" || loadType === "weighted_bodyweight" || loadType === "assisted") {
    compound.leverageFactor = components_.reduce((sum, c) => sum + (c.exercise.leverageFactor ?? 0), 0);
  }
  if (loadType === "time" || loadType === "distance") {
    compound.intensityFactor = components_.reduce((sum, c) => sum + (c.exercise.intensityFactor ?? 0), 0);
  }

  compoundRegistry.set(id, compound);
  return compound;
}

function blendMuscleContributions(components: Array<{ exercise: Exercise; emphasis: number }>): MuscleContribution[] {
  const totals = new Map<MuscleId, number>();
  const totalEmphasis = components.reduce((sum, c) => sum + c.emphasis, 0);

  for (const { exercise, emphasis } of components) {
    for (const contribution of exercise.muscles) {
      const weightedShare = (contribution.share * emphasis) / totalEmphasis;
      totals.set(contribution.muscle, (totals.get(contribution.muscle) ?? 0) + weightedShare);
    }
  }

  return Array.from(totals.entries()).map(([muscle, share]) => ({ muscle, share }));
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
