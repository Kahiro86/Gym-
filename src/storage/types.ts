import type { Equipment, LoadType, MuscleContribution } from "../domain/types.js";
import type { MuscleId } from "../domain/muscles.js";
import type { PrType } from "../domain/types.js";

// Every user-owned table carries these four columns from day one (spec
// §2.4/§4.3) — retrofitting them onto a populated database later is far
// more painful than including them now, even though sync ships in Phase 3.
export interface SyncColumns {
  updatedAt: number; // epoch ms, set on every write
  deletedAt: number | null; // soft-delete tombstone (§2.5) — never hard-delete
  deviceId: string;
  syncedAt: number | null; // null or < updatedAt means dirty
}

export interface ExerciseRecord extends SyncColumns {
  id: string;
  name: string;
  aliases: string[];
  loadType: LoadType;
  limbsLoaded: 1 | 2;
  unilateral: boolean;
  leverageFactor?: number;
  intensityFactor?: number;
  muscles: MuscleContribution[];
  equipment: Equipment[];
  referenceVolume: number;
  defaultRestSeconds: number;
  isCustom: boolean; // false for seeded catalog entries, true for user-created
}

export interface SessionRecord extends SyncColumns {
  id: string;
  startedAt: number;
  endedAt: number | null; // null = in progress
  note: string | null;
  routineId: string | null;
}

export interface SetRecord extends SyncColumns {
  id: string;
  sessionId: string;
  exerciseId: string;
  orderIndex: number; // position within the exercise, for reordering
  weightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  // Denormalized deliberately (§4.2): bodyweight exercises derive load from
  // the user's bodyweight, and recomputing an old set against *today's*
  // bodyweight would silently rewrite history. Snapshot at log time.
  bodyweightKgAtTime: number;
  loggedAt: number;
}

export interface BodyweightLogRecord extends SyncColumns {
  id: string;
  bodyweightKg: number;
  recordedAt: number;
}

export type Units = "kg" | "lb";
export type Theme = "light" | "dark" | "system";

export interface SettingsRecord extends SyncColumns {
  id: "singleton";
  units: Units;
  weeklyTargetSessions: number | null;
  theme: Theme;
  // This install's own stable identity (generated once, on first run).
  // Distinct from `deviceId` (SyncColumns): that says which device last
  // wrote *this row*; `installDeviceId` says which device *this is*, and
  // stays fixed even if a synced settings row arrives from elsewhere.
  installDeviceId: string;
}

// prCache / muscleXpCache: disposable, rebuildable-from-scratch derived
// state (§6). Not sync columns — caches never sync, they rebuild locally.
export interface PrCacheRecord {
  exerciseId: string; // primary key
  maxWeightKg: number;
  maxVolumeSingleSet: number;
  repsAtLoad: Array<{ loadKg: number; reps: number }>;
  engineVersion: number;
}

export interface MuscleXpCacheRecord {
  muscleId: MuscleId; // primary key
  xp: number;
  engineVersion: number;
}

export type PrCountsRecord = Record<PrType, number>;

export type SyncOperation = "upsert" | "delete";
export type SyncEntityType = "exercise" | "session" | "set" | "bodyweightLog" | "settings";

export interface SyncQueueRecord {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  createdAt: number;
  attempts: number;
}
