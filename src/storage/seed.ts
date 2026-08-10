import { EXERCISE_CATALOG } from "../domain/catalog.js";
import { now } from "./ids.js";
import type { GymDatabase } from "./db.js";
import type { Exercise } from "../domain/types.js";
import type { ExerciseRecord } from "./types.js";

export interface SeedResult {
  inserted: number;
  updated: number;
  skipped: number;
}

function toExerciseRecord(exercise: Exercise, deviceId: string, timestamp: number): ExerciseRecord {
  return {
    id: exercise.id,
    name: exercise.name,
    aliases: exercise.aliases,
    loadType: exercise.loadType,
    limbsLoaded: exercise.limbsLoaded,
    unilateral: exercise.unilateral,
    leverageFactor: exercise.leverageFactor,
    intensityFactor: exercise.intensityFactor,
    muscles: exercise.muscles,
    equipment: exercise.equipment,
    referenceVolume: exercise.referenceVolume,
    defaultRestSeconds: exercise.defaultRestSeconds,
    isCustom: false,
    updatedAt: timestamp,
    deletedAt: null,
    deviceId,
    syncedAt: null,
  };
}

// Content-only equality — ignores sync columns, which change on every
// write regardless of whether anything meaningful did.
function contentEquals(a: ExerciseRecord, b: ExerciseRecord): boolean {
  const { updatedAt: _au, deletedAt: _ad, deviceId: _adid, syncedAt: _as, ...aRest } = a;
  const { updatedAt: _bu, deletedAt: _bd, deviceId: _bdid, syncedAt: _bs, ...bRest } = b;
  return JSON.stringify(aRest) === JSON.stringify(bRest);
}

// Idempotent: safe to call on every app start. Re-seeding always refreshes
// built-in rows with the latest Layer 1 catalog data (so a catalog update
// ships to existing installs) but never touches user-created entries, and
// preserves a user's local soft-delete of a built-in exercise rather than
// resurrecting it.
//
// Built-in rows are never enqueued to syncQueue: they're deterministically
// derived from the Layer 1 source every device already ships with, so
// syncing them would just be redundant traffic. Only user-created custom
// exercises (via the exercise repository's createCustom) sync.
export async function seedCatalog(db: GymDatabase): Promise<SeedResult> {
  const deviceId = await db.getDeviceId();
  const result: SeedResult = { inserted: 0, updated: 0, skipped: 0 };

  await db.transaction("rw", db.exercises, async () => {
    for (const exercise of EXERCISE_CATALOG) {
      const existing = await db.exercises.get(exercise.id);

      if (existing?.isCustom) {
        // id collision with a user-created exercise — never overwrite it
        result.skipped++;
        continue;
      }

      const candidate = toExerciseRecord(exercise, deviceId, now());

      if (!existing) {
        await db.exercises.put(candidate);
        result.inserted++;
        continue;
      }

      candidate.deletedAt = existing.deletedAt;
      if (contentEquals(existing, candidate)) {
        result.skipped++;
        continue;
      }

      await db.exercises.put(candidate);
      result.updated++;
    }
  });

  return result;
}
