import { SCHEMA_VERSION } from "./db.js";
import type { GymDatabase } from "./db.js";
import type {
  BodyweightLogRecord,
  DeviceSettingsRecord,
  ExerciseRecord,
  ProfileRecord,
  RoutineExerciseRecord,
  RoutineRecord,
  SessionExerciseRecord,
  SessionRecord,
  SetRecord,
  SettingsRecord,
} from "./types.js";

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: number;
  exercises: ExerciseRecord[];
  routines: RoutineRecord[];
  routineExercises: RoutineExerciseRecord[];
  sessions: SessionRecord[];
  sessionExercises: SessionExerciseRecord[];
  sets: SetRecord[];
  bodyweightLog: BodyweightLogRecord[];
  profile: ProfileRecord[];
  settings: SettingsRecord[];
  deviceSettings: DeviceSettingsRecord[];
}

export interface ImportResult {
  exercises: number;
  routines: number;
  routineExercises: number;
  sessions: number;
  sessionExercises: number;
  sets: number;
  bodyweightLog: number;
}

// Only the raw, source-of-truth tables (§2.1) — prCache/muscleXpCache are
// disposable derived state (task 14 rebuilds them; they're never exported)
// and syncQueue/syncLog are transient local transport state, not backup
// content. deviceSettings IS included, unlike sync: a restore should
// reproduce the whole local experience, not just the synced slice.
export async function exportData(db: GymDatabase): Promise<ExportBundle> {
  const [exercises, routines, routineExercises, sessions, sessionExercises, sets, bodyweightLog, profile, settings, deviceSettings] =
    await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routineExercises.toArray(),
      db.sessions.toArray(),
      db.sessionExercises.toArray(),
      db.sets.toArray(),
      db.bodyweightLog.toArray(),
      db.profile.toArray(),
      db.settings.toArray(),
      db.deviceSettings.toArray(),
    ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    exercises,
    routines,
    routineExercises,
    sessions,
    sessionExercises,
    sets,
    bodyweightLog,
    profile,
    settings,
    deviceSettings,
  };
}

// A full restore, not a merge: every row in every raw table is replaced
// with the bundle's contents. prCache/muscleXpCache are untouched here —
// once task 14 lands, the caller should follow this with a derived-state
// rebuild; there's nothing to rebuild against yet at this point in the
// build sequence (§12 deliberately orders export/import before caches).
export async function importData(db: GymDatabase, bundle: ExportBundle): Promise<ImportResult> {
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Cannot import a backup from a newer schema version (backup: ${bundle.schemaVersion}, app: ${SCHEMA_VERSION}). Update the app first.`
    );
  }
  if (bundle.settings.length !== 1) {
    throw new Error(`Malformed backup: expected exactly one settings row, found ${bundle.settings.length}.`);
  }

  // This device's own identity survives the restore even though every
  // other settings field comes from the backup — installDeviceId names
  // *this install*, not whichever device the backup was taken on.
  const installDeviceId = await db.getDeviceId();
  const restoredSettings: SettingsRecord = { ...bundle.settings[0]!, id: "singleton", installDeviceId };

  await db.transaction(
    "rw",
    [db.exercises, db.routines, db.routineExercises, db.sessions, db.sessionExercises, db.sets, db.bodyweightLog, db.profile, db.settings, db.deviceSettings],
    async () => {
      await db.exercises.clear();
      await db.routines.clear();
      await db.routineExercises.clear();
      await db.sessions.clear();
      await db.sessionExercises.clear();
      await db.sets.clear();
      await db.bodyweightLog.clear();
      await db.profile.clear();
      await db.settings.clear();
      await db.deviceSettings.clear();

      await db.exercises.bulkAdd(bundle.exercises);
      await db.routines.bulkAdd(bundle.routines);
      await db.routineExercises.bulkAdd(bundle.routineExercises);
      await db.sessions.bulkAdd(bundle.sessions);
      await db.sessionExercises.bulkAdd(bundle.sessionExercises);
      await db.sets.bulkAdd(bundle.sets);
      await db.bodyweightLog.bulkAdd(bundle.bodyweightLog);
      if (bundle.profile.length > 0) await db.profile.bulkAdd(bundle.profile);
      await db.settings.add(restoredSettings);
      if (bundle.deviceSettings.length > 0) await db.deviceSettings.bulkAdd(bundle.deviceSettings);
    }
  );

  return {
    exercises: bundle.exercises.length,
    routines: bundle.routines.length,
    routineExercises: bundle.routineExercises.length,
    sessions: bundle.sessions.length,
    sessionExercises: bundle.sessionExercises.length,
    sets: bundle.sets.length,
    bodyweightLog: bundle.bodyweightLog.length,
  };
}
