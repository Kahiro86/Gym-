import type { Equipment, LoadType, MuscleContribution } from "../domain/types.js";
import type { MuscleId } from "../domain/muscles.js";
import type { PrType } from "../domain/types.js";

// Every user-owned table carries these columns from day one (spec
// §2.4/§5.4) — retrofitting them onto a populated database later is far
// more painful than including them now, even though sync ships in Phase 3.
export interface SyncColumns {
  updatedAt: number; // epoch ms, set on every local write
  deletedAt: number | null; // soft-delete tombstone (§2.5) — never hard-delete
  deviceId: string;
  syncedAt: number | null; // null or < updatedAt means dirty
  // [v2] Authoritative once synced (§9.2) — device clocks can be wrong, so
  // conflict resolution compares this, not `updatedAt`. Null until the row
  // has been pushed at least once.
  serverUpdatedAt: number | null;
}

// [v2] §6.7: tracks which fields on a *built-in* row the user has edited,
// so re-seeding can refresh untouched fields while preserving edits.
// Always empty for user-created (isCustom: true) rows.
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
  userModifiedFields: string[];
}

// [v2] §5.2/§6.2.
export type SessionState = "in_progress" | "completed" | "discarded" | "abandoned";

export interface SessionRecord extends SyncColumns {
  id: string;
  state: SessionState; // explicit liveness signal — never inferred from endedAt
  startedAt: number;
  endedAt: number | null;
  tzOffsetMinutes: number; // §4: captured at creation, so relocating mid-history doesn't reshuffle past weeks
  note: string | null;
  routineId: string | null; // the routine this session was performed against, if any
  lastActivityAt: number; // bumped by every set write — crash recovery needs no separate autosave
}

// [v2] §5.2: sets belong to an exercise *instance* within a session, not
// straight to the session — this is what distinguishes "bench, squat,
// bench again" from six consecutive bench sets, and gives supersets and
// substitutions somewhere to live.
export interface SessionExerciseRecord extends SyncColumns {
  id: string;
  sessionId: string;
  exerciseId: string;
  orderIndex: number; // sparse (§5.5) — increments of 1000
  supersetGroup: string | null; // shared id groups exercises into a superset
  note: string | null;
  substitutedFromId: string | null; // records a SWAP: the exerciseId this replaced
  // Links back to the routine's prescription for this slot, when the
  // session was performed against a routine — the plan-vs-performed
  // comparison task 13 needs.
  plannedFromRoutineExerciseId: string | null;
}

export interface SetRecord extends SyncColumns {
  id: string;
  sessionExerciseId: string;
  // [v2] Denormalized deliberately (§5.6): keeps "what did I lift last
  // time on this exercise" a single-index query instead of a join through
  // sessionExercises.
  exerciseId: string;
  orderIndex: number; // sparse (§5.5)
  weightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  isWarmup: boolean; // [v2] no XP, no PR, excluded from lastPerformance
  completed: boolean; // [v2] false = failed attempt — also excluded from lastPerformance
  targetReps: number | null; // [v2] prescription, when logged against a routine
  note: string | null;
  // Denormalized deliberately (§5.3): bodyweight exercises derive load from
  // the user's bodyweight, and recomputing an old set against *today's*
  // bodyweight would silently rewrite history. Snapshot at log time.
  bodyweightKgAtTime: number;
  loggedAt: number;
  restBeforeSec: number | null; // [v2] derived at write time from the previous set's loggedAt
}

export interface BodyweightLogRecord extends SyncColumns {
  id: string;
  bodyweightKg: number;
  recordedAt: number;
}

// [v2] §8: singleton, never synced — height/birth date/sex feed 1RM-style
// estimates and BMR-adjacent math, not training history itself.
export type Sex = "male" | "female" | "unspecified";

export interface ProfileRecord extends SyncColumns {
  id: "singleton";
  heightCm: number | null;
  birthDate: string | null; // ISO calendar date (YYYY-MM-DD) — no time-of-day meaning
  sex: Sex | null;
}

export type Units = "kg" | "lb";
export type Theme = "light" | "dark" | "system";

// [v2] §8: settings split into synced (per-account training preferences)
// and device-local (per-device UI preferences) tables — syncing theme
// across devices is wrong, so this is two tables, not one table with a flag.
export interface SettingsRecord extends SyncColumns {
  id: "singleton";
  units: Units;
  weeklyTargetSessions: number | null;
  defaultRestSeconds: number; // the user's own target rest, distinct from any one exercise's catalog default
  // This install's own stable identity (generated once, on first run).
  // Distinct from `deviceId` (SyncColumns): that says which device last
  // wrote *this row*; `installDeviceId` says which device *this is*, and
  // stays fixed even if a synced settings row arrives from elsewhere.
  installDeviceId: string;
}

// [v2] Never carries sync columns — never leaves the device, so there is
// nothing to reconcile. Week start day was decided fixed at Monday (not a
// user setting) rather than added here — see time.ts.
export interface DeviceSettingsRecord {
  id: "singleton";
  theme: Theme;
  reduceMotion: boolean;
  soundEnabled: boolean;
  restTimerAutoStart: boolean;
  restTimerSoundEnabled: boolean;
  persistenceGranted: boolean; // §2.6 — surfaced in the debug menu
  updatedAt: number;
}

// [v2] §13: saved workout templates.
export interface RoutineRecord extends SyncColumns {
  id: string;
  name: string;
  note: string | null;
}

export interface RoutineExerciseRecord extends SyncColumns {
  id: string;
  routineId: string;
  exerciseId: string;
  orderIndex: number; // sparse (§5.5)
  supersetGroup: string | null;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightKg: number | null;
  note: string | null;
}

// prCache / muscleXpCache: disposable, rebuildable-from-scratch derived
// state (§7). Not sync columns — caches never sync, they rebuild locally.
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
export type SyncEntityType =
  | "exercise"
  | "session"
  | "sessionExercise"
  | "set"
  | "bodyweightLog"
  | "profile"
  | "settings"
  | "routine"
  | "routineExercise";

export interface SyncQueueRecord {
  id: string;
  // [v2] §9.3: idempotency key. The server upserts on row `id` and rejects
  // a duplicate mutationId — a retried partially-applied batch must not
  // double-apply.
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  createdAt: number;
  attempts: number;
}

// [v2] §9.6: the last 200 sync attempts, surfaced in the debug menu — the
// only evidence available when sync breaks in the wild.
export type SyncDirection = "push" | "pull";
export type SyncOutcome = "success" | "failure";

export interface SyncLogRecord {
  id: string;
  timestamp: number;
  direction: SyncDirection;
  entityCounts: Partial<Record<SyncEntityType, number>>;
  outcome: SyncOutcome;
  error: string | null;
}
