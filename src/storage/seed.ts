import { EXERCISE_CATALOG } from "../domain/catalog.js";
import { now } from "./ids.js";
import type { GymDatabase } from "./db.js";
import type { Exercise } from "../domain/types.js";
import type { ExerciseRecord } from "./types.js";

export interface SeedResult {
  inserted: number;
  updated: number;
  skipped: number;
  removed: number; // soft-deleted because the catalog no longer has them
}

// §6.7: these two are tuning constants, not editorial content — a fix here
// always takes effect, even overriding a user's own edit, because
// correctness beats stability and XP is derived from them anyway (§2.1).
// Every other content field is refreshed from source UNLESS the user has
// edited it (tracked in userModifiedFields).
const ALWAYS_REFRESHED_FIELDS = ["leverageFactor", "referenceVolume"] as const;

const CONTENT_FIELDS = [
  "name",
  "aliases",
  "loadType",
  "limbsLoaded",
  "unilateral",
  "leverageFactor",
  "intensityFactor",
  "muscles",
  "equipment",
  "defaultRestSeconds",
] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];

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
    userModifiedFields: [],
    updatedAt: timestamp,
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  };
}

function copyField<K extends ContentField>(target: ExerciseRecord, source: ExerciseRecord, field: K): void {
  target[field] = source[field];
}

// Merges a freshly-derived catalog row onto an existing built-in row:
// fields the user has edited are preserved from `existing`; every other
// field (including anything the catalog source has changed since the last
// seed) refreshes to `fresh`; leverageFactor/referenceVolume always
// refresh regardless of userModifiedFields (§6.7).
function mergeBuiltin(existing: ExerciseRecord, fresh: ExerciseRecord): ExerciseRecord {
  const merged: ExerciseRecord = { ...fresh, deletedAt: existing.deletedAt, userModifiedFields: existing.userModifiedFields };
  for (const field of CONTENT_FIELDS) {
    if ((ALWAYS_REFRESHED_FIELDS as readonly string[]).includes(field)) continue;
    if (existing.userModifiedFields.includes(field)) {
      copyField(merged, existing, field);
    }
  }
  return merged;
}

// Content-only equality — ignores sync columns, which change on every
// write regardless of whether anything meaningful did.
function contentEquals(a: ExerciseRecord, b: ExerciseRecord): boolean {
  const { updatedAt: _au, deletedAt: _ad, deviceId: _adid, syncedAt: _as, serverUpdatedAt: _asu, ...aRest } = a;
  const { updatedAt: _bu, deletedAt: _bd, deviceId: _bdid, syncedAt: _bs, serverUpdatedAt: _bsu, ...bRest } = b;
  return JSON.stringify(aRest) === JSON.stringify(bRest);
}

// Idempotent: safe to call on every app start (§6.7).
//
// - User-created exercises (isCustom: true): never touched, even on an id
//   collision — this should be impossible (custom ids are UUIDs) but is
//   guarded regardless.
// - Built-ins the user has edited: keep the edited fields, refresh
//   everything else to the latest source.
// - Built-ins removed from the catalog: soft-deleted only if the user has
//   never logged a set against them — deleting an exercise can never orphan
//   history (§6.5/§14 DoD).
// - Built-in rows are never enqueued to syncQueue: they're deterministically
//   derived from the Layer 1 source every device already ships with,
//   syncing them would just be redundant traffic.
export async function seedCatalog(db: GymDatabase): Promise<SeedResult> {
  const deviceId = await db.getDeviceId();
  const result: SeedResult = { inserted: 0, updated: 0, skipped: 0, removed: 0 };
  const catalogIds = new Set(EXERCISE_CATALOG.map((e) => e.id));

  await db.transaction("rw", db.exercises, db.sets, async () => {
    for (const exercise of EXERCISE_CATALOG) {
      const existing = await db.exercises.get(exercise.id);
      const fresh = toExerciseRecord(exercise, deviceId, now());

      if (!existing) {
        await db.exercises.add(fresh);
        result.inserted++;
        continue;
      }
      if (existing.isCustom) {
        result.skipped++;
        continue;
      }

      const merged = mergeBuiltin(existing, fresh);
      if (contentEquals(existing, merged)) {
        result.skipped++;
        continue;
      }
      await db.exercises.put(merged);
      result.updated++;
    }

    const staleBuiltins = await db.exercises
      .filter((row) => !row.isCustom && row.deletedAt === null && !catalogIds.has(row.id))
      .toArray();
    for (const row of staleBuiltins) {
      // No standalone exerciseId index on `sets` in v2 (§5.6 lists only the
      // compound ones) — this rare, admin-only check (an exercise leaving
      // the catalog entirely) is a plain table scan rather than a new
      // index carried on every write for something that almost never runs.
      // Every set ever logged counts, deleted or not — removing the
      // exercise row must never orphan a set (§14 DoD), including a
      // tombstoned one.
      const hasHistory = (await db.sets.filter((s) => s.exerciseId === row.id).count()) > 0;
      if (!hasHistory) {
        await db.exercises.update(row.id, { deletedAt: now(), updatedAt: now(), deviceId });
        result.removed++;
      }
    }
  });

  return result;
}
