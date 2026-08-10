import Dexie, { type Table } from "dexie";
import { newId, now } from "./ids.js";
import type {
  ExerciseRecord,
  SessionRecord,
  SetRecord,
  BodyweightLogRecord,
  SettingsRecord,
  PrCacheRecord,
  MuscleXpCacheRecord,
  SyncQueueRecord,
} from "./types.js";

export const SCHEMA_VERSION = 1;
// Bumped whenever Layer 1's XP constants/formulas change (XP_CONSTANT,
// level curve, PR bonuses, ...). A mismatch on startup wipes and rebuilds
// the derived caches (§6) — never the raw sets/sessions, which are the
// only source of truth (§2.1).
export const ENGINE_VERSION = 1;

const DEFAULT_DB_NAME = "gymxp";
const SETTINGS_ID = "singleton" as const;

// db.ts — Dexie schema (spec §4.1/§4.4). Forward-only versioned
// migrations: never edit a shipped version() block (§8) — add a new one.
export class GymDatabase extends Dexie {
  exercises!: Table<ExerciseRecord, string>;
  sessions!: Table<SessionRecord, string>;
  sets!: Table<SetRecord, string>;
  bodyweightLog!: Table<BodyweightLogRecord, string>;
  settings!: Table<SettingsRecord, string>;
  prCache!: Table<PrCacheRecord, string>;
  muscleXpCache!: Table<MuscleXpCacheRecord, string>;
  syncQueue!: Table<SyncQueueRecord, string>;

  private cachedDeviceId: string | undefined;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    this.version(SCHEMA_VERSION).stores({
      exercises: "id, name, *aliases, loadType, updatedAt",
      sessions: "id, startedAt, [deletedAt+startedAt], updatedAt",
      sets: "id, sessionId, exerciseId, loggedAt, [exerciseId+loggedAt], [sessionId+orderIndex], updatedAt",
      bodyweightLog: "id, recordedAt, updatedAt",
      settings: "id",
      prCache: "exerciseId",
      muscleXpCache: "muscleId",
      syncQueue: "id, createdAt, entityType",
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
        theme: "system",
        installDeviceId,
        updatedAt: now(),
        deletedAt: null,
        deviceId: installDeviceId,
        syncedAt: null,
      };
      await this.settings.add(fresh);
      return fresh;
    });
  }
}

export function openDatabase(name?: string): GymDatabase {
  return new GymDatabase(name);
}
