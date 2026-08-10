import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { allExercises } from "../../domain/registry.js";
import { scoreExerciseMatch } from "../../domain/search.js";
import type { GymDatabase } from "../db.js";
import type { ExerciseRecord } from "../types.js";
import type { Equipment, Exercise, LoadType, MuscleContribution } from "../../domain/types.js";

export interface NewExercise {
  name: string;
  aliases?: string[];
  loadType: LoadType;
  limbsLoaded: 1 | 2;
  unilateral: boolean;
  leverageFactor?: number;
  intensityFactor?: number;
  muscles: MuscleContribution[];
  equipment: Equipment[];
  referenceVolume: number;
  defaultRestSeconds: number;
}

export interface ExerciseRepository {
  search(query: string, limit: number): Promise<Exercise[]>;
  getById(id: string): Promise<Exercise | null>;
  createCustom(input: NewExercise): Promise<Exercise>;
}

function toExercise(record: ExerciseRecord): Exercise {
  return {
    id: record.id,
    name: record.name,
    aliases: record.aliases,
    loadType: record.loadType,
    limbsLoaded: record.limbsLoaded,
    unilateral: record.unilateral,
    leverageFactor: record.leverageFactor,
    intensityFactor: record.intensityFactor,
    muscles: record.muscles,
    equipment: record.equipment,
    referenceVolume: record.referenceVolume,
    defaultRestSeconds: record.defaultRestSeconds,
  };
}

// The [exerciseId+loggedAt] index has no cross-exercise "most recent"
// query, and a full-table scan would grow unbounded with a user's history.
// Sampling the most recent N sets table-wide is enough for a *tiebreak*
// (not a source of truth) — an exercise outside the sample just reads as
// "not recently used" rather than incorrectly ranked.
const RECENCY_SAMPLE_SIZE = 500;

async function loadRecentUsage(db: GymDatabase): Promise<Map<string, number>> {
  // No .filter() chained onto the Dexie query — see setRepository.ts for
  // why that forces slow per-row cursor gets. Filtered in JS below instead.
  const rows = await db.sets.orderBy("loggedAt").reverse().limit(RECENCY_SAMPLE_SIZE).toArray();
  const recent = new Map<string, number>();
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    if (!recent.has(row.exerciseId)) recent.set(row.exerciseId, row.loggedAt);
  }
  return recent;
}

async function loadCustomExercises(db: GymDatabase): Promise<Exercise[]> {
  const rows = await db.exercises.toArray();
  return rows.filter((r) => r.isCustom && r.deletedAt === null).map(toExercise);
}

export function createExerciseRepository(db: GymDatabase): ExerciseRepository {
  // Built once and reused across calls (spec §5.1: never re-query
  // IndexedDB per keystroke). Only createCustom() below invalidates it.
  let indexPromise: Promise<{ exercises: Exercise[]; byId: Map<string, Exercise>; recentUsage: Map<string, number> }> | undefined;

  async function buildIndex() {
    const [custom, recentUsage] = await Promise.all([loadCustomExercises(db), loadRecentUsage(db)]);
    const exercises = [...allExercises(), ...custom];
    const byId = new Map(exercises.map((e) => [e.id, e]));
    return { exercises, byId, recentUsage };
  }

  function ensureIndex() {
    if (!indexPromise) indexPromise = buildIndex();
    return indexPromise;
  }

  return {
    async search(query, limit) {
      const { exercises, recentUsage } = await ensureIndex();
      const q = query.trim().toLowerCase();

      return exercises
        .map((exercise) => ({ exercise, score: scoreExerciseMatch(exercise, q) }))
        .filter((entry) => q === "" || entry.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const recencyDiff = (recentUsage.get(b.exercise.id) ?? 0) - (recentUsage.get(a.exercise.id) ?? 0);
          if (recencyDiff !== 0) return recencyDiff;
          return a.exercise.name.localeCompare(b.exercise.name);
        })
        .slice(0, limit)
        .map((entry) => entry.exercise);
    },

    async getById(id) {
      const { byId } = await ensureIndex();
      return byId.get(id) ?? null;
    },

    async createCustom(input) {
      const deviceId = await db.getDeviceId();
      const record: ExerciseRecord = {
        id: newId(),
        name: input.name,
        aliases: input.aliases ?? [],
        loadType: input.loadType,
        limbsLoaded: input.limbsLoaded,
        unilateral: input.unilateral,
        leverageFactor: input.leverageFactor,
        intensityFactor: input.intensityFactor,
        muscles: input.muscles,
        equipment: input.equipment,
        referenceVolume: input.referenceVolume,
        defaultRestSeconds: input.defaultRestSeconds,
        isCustom: true,
        updatedAt: now(),
        deletedAt: null,
        deviceId,
        syncedAt: null,
      };

      await db.transaction("rw", db.exercises, db.syncQueue, async () => {
        await db.exercises.add(record);
        // Unlike built-in catalog rows (seed.ts), a custom exercise only
        // exists on the device that created it until sync pushes it.
        await enqueueSync(db, "exercise", record.id, "upsert");
      });

      indexPromise = undefined; // force a rebuild so the new exercise is searchable
      return toExercise(record);
    },
  };
}
