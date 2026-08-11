import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { allExercises } from "../../domain/registry.js";
import { scoreExerciseMatch } from "../../domain/search.js";
import { getMuscle } from "../../domain/muscles.js";
import type { GymDatabase } from "../db.js";
import type { ExerciseRecord } from "../types.js";
import type { Equipment, Exercise, LoadType, MuscleContribution } from "../../domain/types.js";
import type { GroupId } from "../../domain/muscles.js";

export interface NewCustomExercise {
  name: string;
  aliases?: string[];
  loadType: LoadType;
  // "A rough movement category" (§6.6) — the existing head-level muscle
  // taxonomy's own group, reused rather than inventing a parallel one.
  primaryGroup: GroupId;
  limbsLoaded: 1 | 2;
  unilateral: boolean;
  muscles: MuscleContribution[];
  equipment: Equipment[];
  defaultRestSeconds: number;
}

export interface ExerciseRepository {
  search(query: string, limit: number): Promise<Exercise[]>;
  getById(id: string): Promise<Exercise | null>;
  createCustom(input: NewCustomExercise): Promise<Exercise>;
  // §6.5: "delete" hides an exercise from search only — the row, and every
  // set ever logged against it, persist forever; deleting an exercise can
  // never orphan a set. Built-in exercises can never be hidden at all,
  // only exercises the user created.
  hide(id: string): Promise<void>;
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

const LOAD_TYPES_NEEDING_LEVERAGE: ReadonlySet<LoadType> = new Set(["bodyweight", "weighted_bodyweight", "assisted", "distance"]);
const LOAD_TYPES_NEEDING_INTENSITY: ReadonlySet<LoadType> = new Set(["time"]);

function primaryGroupOf(exercise: Exercise): GroupId | undefined {
  if (exercise.muscles.length === 0) return undefined;
  const top = exercise.muscles.reduce((a, b) => (b.share > a.share ? b : a));
  return getMuscle(top.muscle).groupId;
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// §6.6: the XP engine requires referenceVolume, and leverageFactor for
// load types that use it — a custom exercise created without them either
// crashes the engine or silently earns nothing. Rather than trust a raw
// user-typed number forever, derive both from the nearest catalog
// archetype: same loadType, and — when any exist — the same primary
// muscle group. Falls back to just loadType if no group match exists.
function deriveConstants(loadType: LoadType, primaryGroup: GroupId): { referenceVolume: number; leverageFactor?: number; intensityFactor?: number } {
  const singleExercises = allExercises().filter((e) => !e.components);
  const sameGroupAndType = singleExercises.filter((e) => e.loadType === loadType && primaryGroupOf(e) === primaryGroup);
  const pool = sameGroupAndType.length > 0 ? sameGroupAndType : singleExercises.filter((e) => e.loadType === loadType);

  if (pool.length === 0) {
    throw new Error(`No catalog archetype exists for loadType "${loadType}" — cannot derive referenceVolume.`);
  }

  const referenceVolume = Math.round(average(pool.map((e) => e.referenceVolume)));
  const leverageValues = pool.map((e) => e.leverageFactor).filter((v): v is number => v !== undefined);
  const intensityValues = pool.map((e) => e.intensityFactor).filter((v): v is number => v !== undefined);

  if (LOAD_TYPES_NEEDING_LEVERAGE.has(loadType) && leverageValues.length === 0) {
    throw new Error(`No catalog archetype with a leverageFactor exists for loadType "${loadType}" — cannot derive one.`);
  }
  if (LOAD_TYPES_NEEDING_INTENSITY.has(loadType) && intensityValues.length === 0) {
    throw new Error(`No catalog archetype with an intensityFactor exists for loadType "${loadType}" — cannot derive one.`);
  }

  return {
    referenceVolume,
    leverageFactor: leverageValues.length > 0 ? average(leverageValues) : undefined,
    intensityFactor: intensityValues.length > 0 ? average(intensityValues) : undefined,
  };
}

export function createExerciseRepository(db: GymDatabase): ExerciseRepository {
  // Built once (§6.4: never re-query IndexedDB per keystroke) and mutated
  // in place by createCustom()/hide() afterward — [v2] an incremental
  // update, never a full rebuild.
  let index: Exercise[] | undefined;
  let byId: Map<string, Exercise> | undefined;
  let hiddenCustomIds: Set<string> | undefined;

  async function ensureIndex() {
    if (index && byId && hiddenCustomIds) return { index, byId, hiddenCustomIds };
    const customRows = (await db.exercises.toArray()).filter((r) => r.isCustom);
    index = [...allExercises(), ...customRows.map(toExercise)];
    byId = new Map(index.map((e) => [e.id, e]));
    hiddenCustomIds = new Set(customRows.filter((r) => r.deletedAt !== null).map((r) => r.id));
    return { index, byId, hiddenCustomIds };
  }

  return {
    async search(query, limit) {
      const { index, hiddenCustomIds } = await ensureIndex();
      const q = query.trim().toLowerCase();

      return index
        .filter((exercise) => !hiddenCustomIds.has(exercise.id))
        .map((exercise) => ({ exercise, score: scoreExerciseMatch(exercise, q) }))
        .filter((entry) => q === "" || entry.score > 0)
        .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
        .slice(0, limit)
        .map((entry) => entry.exercise);
    },

    async getById(id) {
      // Deliberately does NOT filter hiddenCustomIds — a hidden exercise
      // must still resolve for anything displaying an old set's details.
      const { byId } = await ensureIndex();
      return byId.get(id) ?? null;
    },

    async createCustom(input) {
      const constants = deriveConstants(input.loadType, input.primaryGroup);
      const deviceId = await db.getDeviceId();
      const record: ExerciseRecord = {
        id: newId(),
        name: input.name,
        aliases: input.aliases ?? [],
        loadType: input.loadType,
        limbsLoaded: input.limbsLoaded,
        unilateral: input.unilateral,
        leverageFactor: constants.leverageFactor,
        intensityFactor: constants.intensityFactor,
        muscles: input.muscles,
        equipment: input.equipment,
        referenceVolume: constants.referenceVolume,
        defaultRestSeconds: input.defaultRestSeconds,
        isCustom: true,
        userModifiedFields: [],
        updatedAt: now(),
        deletedAt: null,
        deviceId,
        syncedAt: null,
        serverUpdatedAt: null,
      };

      await db.transaction("rw", db.exercises, db.syncQueue, async () => {
        await db.exercises.add(record);
        await enqueueSync(db, "exercise", record.id, "upsert");
      });

      const { index, byId } = await ensureIndex();
      const exercise = toExercise(record);
      index.push(exercise);
      byId.set(exercise.id, exercise);
      return exercise;
    },

    async hide(id) {
      const { byId, hiddenCustomIds } = await ensureIndex();
      if (!byId.has(id)) {
        throw new Error(`Cannot hide exercise ${id} — it does not exist.`);
      }
      const row = await db.exercises.get(id);
      if (!row || !row.isCustom) {
        throw new Error(`Cannot hide exercise ${id} — built-in exercises can never be deleted (§6.5).`);
      }

      const deviceId = await db.getDeviceId();
      await db.transaction("rw", db.exercises, db.syncQueue, async () => {
        await db.exercises.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "exercise", id, "upsert");
      });

      hiddenCustomIds.add(id);
    },
  };
}
