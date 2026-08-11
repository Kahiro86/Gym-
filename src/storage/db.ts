import Dexie, { type Table } from "dexie";
import { newId, now } from "./ids.js";
import type {
  ExerciseRecord,
  SessionRecord,
  SessionExerciseRecord,
  SetRecord,
  BodyweightLogRecord,
  ProfileRecord,
  SettingsRecord,
  DeviceSettingsRecord,
  RoutineRecord,
  RoutineExerciseRecord,
  PrCacheRecord,
  MuscleXpCacheRecord,
  SyncQueueRecord,
  SyncLogRecord,
} from "./types.js";

export const SCHEMA_VERSION = 1;
// Bumped whenever Layer 1's XP constants/formulas change (XP_CONSTANT,
// level curve, PR bonuses, ...). A mismatch on startup wipes and rebuilds
// the derived caches (§7) — never the raw sets/sessions, which are the
// only source of truth (§2.1).
export const ENGINE_VERSION = 1;

const DEFAULT_DB_NAME = "gymxp";
const SETTINGS_ID = "singleton" as const;
const PROFILE_ID = "singleton" as const;
const DEVICE_SETTINGS_ID = "singleton" as const;

// db.ts — Dexie schema v2 (spec §5). Forward-only versioned migrations:
// never edit a shipped version() block (§10) — add a new one.
export class GymDatabase extends Dexie {
  exercises!: Table<ExerciseRecord, string>;
  routines!: Table<RoutineRecord, string>;
  routineExercises!: Table<RoutineExerciseRecord, string>;
  sessions!: Table<SessionRecord, string>;
  sessionExercises!: Table<SessionExerciseRecord, string>;
  sets!: Table<SetRecord, string>;
  bodyweightLog!: Table<BodyweightLogRecord, string>;
  profile!: Table<ProfileRecord, string>;
  settings!: Table<SettingsRecord, string>;
  deviceSettings!: Table<DeviceSettingsRecord, string>;
  prCache!: Table<PrCacheRecord, string>;
  muscleXpCache!: Table<MuscleXpCacheRecord, string>;
  syncQueue!: Table<SyncQueueRecord, string>;
  syncLog!: Table<SyncLogRecord, string>;

  private cachedDeviceId: string | undefined;

  constructor(name: string = DEFAULT_DB_NAME, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(SCHEMA_VERSION).stores({
      // §5.6 asks for `deletedAt` inside several indexes (as "isDeleted",
      // adapted to our nullable tombstone — see the note on ExerciseRecord)
      // so soft-delete filtering happens inside the index instead of as a
      // post-fetch predicate. That's not achievable as written: `null` is
      // not a valid IndexedDB key, so a compound (or standalone) index
      // that includes a field which is `null` on every non-deleted row
      // simply never indexes those rows at all — confirmed empirically,
      // `IDBKeyRange.bound()` throws DataError the moment `null` appears
      // in a bound. Every index below omits `deletedAt`; queries fetch via
      // the remaining (always-valid-key) prefix and filter deletedAt in
      // plain JS afterward — proven fast for this size of result set (see
      // setRepository.ts's comment on why .filter() is never chained onto
      // the Dexie query itself).
      exercises: "id, name, *aliases, loadType, updatedAt",
      routines: "id, name, updatedAt",
      sessions: "id, state, startedAt, [state+startedAt], updatedAt",
      sessionExercises: "id, sessionId, exerciseId, [sessionId+orderIndex]",
      // [exerciseId+loggedAt] is the index "what did I lift last time"
      // resolves through — it must stay well under the UI's per-keystroke
      // budget.
      sets: "id, sessionExerciseId, loggedAt, [sessionExerciseId+orderIndex], [exerciseId+loggedAt], updatedAt",
      bodyweightLog: "id, recordedAt, updatedAt",
      profile: "id",
      settings: "id",
      deviceSettings: "id",
      routineExercises: "id, routineId, [routineId+orderIndex]",
      prCache: "exerciseId",
      muscleXpCache: "muscleId",
      syncQueue: "id, createdAt, entityType",
      syncLog: "id, timestamp",
    });
  }

  // Every repository needs this to stamp sync columns on writes. Cached
  // after first resolution — no localStorage involved (spec §3 reserves
  // localStorage for the schema-version pointer and active user id only).
  async getDeviceId(): Promise<string> {
    if (this.cachedDeviceId) return this.cachedDeviceId;
    const settings = await this.getOrCreateSettings();
    this.cachedDeviceId = settings.installDeviceId;
    return this.cachedDeviceId;
  }

  async getOrCreateSettings(): Promise<SettingsRecord> {
    return this.transaction("rw", this.settings, async () => {
      const existing = await this.settings.get(SETTINGS_ID);
      if (existing) return existing;

      const installDeviceId = newId();
      const fresh: SettingsRecord = {
        id: SETTINGS_ID,
        units: "kg",
        weeklyTargetSessions: null,
        defaultRestSeconds: 120,
        installDeviceId,
        updatedAt: now(),
        deletedAt: null,
        deviceId: installDeviceId,
        syncedAt: null,
        serverUpdatedAt: null,
      };
      await this.settings.add(fresh);
      return fresh;
    });
  }

  async getOrCreateDeviceSettings(): Promise<DeviceSettingsRecord> {
    return this.transaction("rw", this.deviceSettings, async () => {
      const existing = await this.deviceSettings.get(DEVICE_SETTINGS_ID);
      if (existing) return existing;

      const fresh: DeviceSettingsRecord = {
        id: DEVICE_SETTINGS_ID,
        theme: "system",
        reduceMotion: false,
        soundEnabled: true,
        restTimerAutoStart: true,
        restTimerSoundEnabled: true,
        persistenceRequested: false,
        persistenceGranted: false,
        updatedAt: now(),
      };
      await this.deviceSettings.add(fresh);
      return fresh;
    });
  }

  async getOrCreateProfile(): Promise<ProfileRecord> {
    // Resolved before opening the transaction: getDeviceId() needs
    // db.settings, which isn't part of this transaction's table set — see
    // the same note on every repository method that mixes tables.
    const deviceId = await this.getDeviceId();
    return this.transaction("rw", this.profile, async () => {
      const existing = await this.profile.get(PROFILE_ID);
      if (existing) return existing;

      const fresh: ProfileRecord = {
        id: PROFILE_ID,
        heightCm: null,
        birthDate: null,
        sex: null,
        updatedAt: now(),
        deletedAt: null,
        deviceId,
        syncedAt: null,
        serverUpdatedAt: null,
      };
      await this.profile.add(fresh);
      return fresh;
    });
  }
}

// [v2] §3.1: Firefox strict mode, private browsing, and some embedded
// webviews block IndexedDB outright. Probe with a real (disposable) open
// rather than trusting feature detection alone — some environments expose
// `indexedDB` but reject every operation.
export async function isIndexedDbAvailable(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;

  return new Promise<boolean>((resolve) => {
    try {
      const probeName = "__gymxp_indexeddb_probe__";
      const request = indexedDB.open(probeName);
      request.onsuccess = () => {
        request.result.close();
        try {
          indexedDB.deleteDatabase(probeName);
        } catch {
          // Cleanup best-effort — availability is already proven either way.
        }
        resolve(true);
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export interface OpenDatabaseResult {
  db: GymDatabase;
  // True when the real browser IndexedDB was unavailable and `db` is
  // backed by an in-memory engine instead — nothing written to it survives
  // a reload. Layer 3 must show a persistent banner and enable export when
  // this is true (§3.1); it must never fail silently.
  degraded: boolean;
}

// The safe way to open a database from Layer 3: probes IndexedDB and, on
// failure, falls back to an in-memory-only backend running the identical
// Dexie schema and repository code — no parallel storage implementation to
// maintain, no behavioral drift between normal and degraded mode.
export async function openDatabaseSafely(name?: string): Promise<OpenDatabaseResult> {
  const available = await isIndexedDbAvailable();
  if (available) {
    return { db: new GymDatabase(name), degraded: false };
  }

  const fakeIndexedDb = await import("fake-indexeddb");
  const db = new GymDatabase(name, { indexedDB: fakeIndexedDb.indexedDB, IDBKeyRange: fakeIndexedDb.IDBKeyRange });
  return { db, degraded: true };
}

// Direct construction, bypassing the availability probe — for tests and
// any caller that already knows which backend it wants.
export function openDatabase(name?: string): GymDatabase {
  return new GymDatabase(name);
}
