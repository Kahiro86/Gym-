import { SCHEMA_VERSION } from "./db.js";
import { createDerivedStateRepository } from "./repositories/derivedStateRepository.js";
import type { GymDatabase } from "./db.js";
import type { BodyweightLogRecord, ExerciseRecord, SessionRecord, SetRecord, SettingsRecord } from "./types.js";

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: number;
  exercises: ExerciseRecord[];
  sessions: SessionRecord[];
  sets: SetRecord[];
  bodyweightLog: BodyweightLogRecord[];
  settings: SettingsRecord[];
}

export interface ImportResult {
  exercises: number;
  sessions: number;
  sets: number;
  bodyweightLog: number;
}

// Only the raw, source-of-truth tables (§2.1) — prCache/muscleXpCache are
// disposable derived state (rebuilt after import, never exported) and
// syncQueue is transient local transport state, not backup content.
export async function exportData(db: GymDatabase): Promise<ExportBundle> {
  const [exercises, sessions, sets, bodyweightLog, settings] = await Promise.all([
    db.exercises.toArray(),
    db.sessions.toArray(),
    db.sets.toArray(),
    db.bodyweightLog.toArray(),
    db.settings.toArray(),
  ]);

  return { schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), exercises, sessions, sets, bodyweightLog, settings };
}

// A full restore, not a merge: every row in the four raw tables is replaced
// with the bundle's contents. Derived caches are rebuilt afterward since
// they aren't part of the bundle and would otherwise read stale post-restore.
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

  await db.transaction("rw", db.exercises, db.sessions, db.sets, db.bodyweightLog, db.settings, async () => {
    await db.exercises.clear();
    await db.sessions.clear();
    await db.sets.clear();
    await db.bodyweightLog.clear();
    await db.settings.clear();

    await db.exercises.bulkAdd(bundle.exercises);
    await db.sessions.bulkAdd(bundle.sessions);
    await db.sets.bulkAdd(bundle.sets);
    await db.bodyweightLog.bulkAdd(bundle.bodyweightLog);
    await db.settings.add(restoredSettings);
  });

  // Not part of the write transaction above — a rebuild failure shouldn't
  // roll back an otherwise-successful restore of raw data; ensureFresh()
  // (or a manual rebuild) can always recover the caches afterward.
  await createDerivedStateRepository(db).rebuildDerivedState();

  return {
    exercises: bundle.exercises.length,
    sessions: bundle.sessions.length,
    sets: bundle.sets.length,
    bodyweightLog: bundle.bodyweightLog.length,
  };
}
