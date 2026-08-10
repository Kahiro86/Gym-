import type { BodyweightHistory, ExerciseHistory, LoggedSet, MuscleId, PrType } from "../domain/types.js";

// Layer 2 (general): persistence for the whole domain core — the original
// Layer 1 spec explicitly marked this out of scope ("Persistence, sync,
// auth (Layer 2)"). Distinct from heatmap/store.ts, which only persists
// the narrow weekly muscle_week_rollup table for the analytics feature.

export interface StoredSession {
  id: string;
  sets: LoggedSet[];
  loggedAt: number; // epoch ms — when the session was recorded, for streak/day-boundary purposes
}

// Mirrors achievements.ts's PlayerStats minus `level`, which is always
// derived fresh from totalXp (via levelFromTotalXp) rather than stored,
// so the two can never drift out of sync.
export interface CumulativeStats {
  totalXp: number;
  totalSessions: number;
  totalSets: number;
  totalVolume: number;
  muscleXp: Record<MuscleId, number>;
  prCounts: Record<PrType, number>;
}

export interface GymStore {
  // Sessions are the source of truth — needed for edit/delete replay and
  // streak calculation, not just a write-once log.
  upsertSession(session: StoredSession): void;
  getSession(id: string): StoredSession | undefined;
  listSessions(): StoredSession[]; // sorted by loggedAt ascending
  deleteSession(id: string): void;

  getExerciseHistory(): Record<string, ExerciseHistory>;
  setExerciseHistory(history: Record<string, ExerciseHistory>): void;

  getBodyweightHistory(): BodyweightHistory | undefined;
  setBodyweightHistory(history: BodyweightHistory): void;

  getCumulativeStats(): CumulativeStats;
  setCumulativeStats(stats: CumulativeStats): void;

  getUnlockedAchievementIds(): Set<string>;
  setUnlockedAchievementIds(ids: Set<string>): void;
}
