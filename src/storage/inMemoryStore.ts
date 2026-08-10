import { MUSCLE_IDS } from "../domain/muscles.js";
import { emptyPrCounts } from "../domain/achievements.js";
import type { BodyweightHistory, ExerciseHistory, MuscleId } from "../domain/types.js";
import type { CumulativeStats, GymStore, StoredSession } from "./types.js";

export function emptyCumulativeStats(): CumulativeStats {
  const muscleXp = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) muscleXp[muscle] = 0;
  return {
    totalXp: 0,
    totalSessions: 0,
    totalSets: 0,
    totalVolume: 0,
    muscleXp,
    prCounts: emptyPrCounts(),
  };
}

// Reference implementation matching the GymStore interface exactly —
// swappable for real SQLite/IndexedDB/Supabase later without touching
// callers, since they only ever see the GymStore interface (same pattern
// as heatmap/store.ts's InMemoryMuscleRollupStore).
export class InMemoryGymStore implements GymStore {
  private sessions = new Map<string, StoredSession>();
  private exerciseHistory: Record<string, ExerciseHistory> = {};
  private bodyweightHistory: BodyweightHistory | undefined;
  private cumulativeStats: CumulativeStats = emptyCumulativeStats();
  private unlockedAchievementIds = new Set<string>();

  upsertSession(session: StoredSession): void {
    this.sessions.set(session.id, session);
  }

  getSession(id: string): StoredSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): StoredSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => a.loggedAt - b.loggedAt);
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  getExerciseHistory(): Record<string, ExerciseHistory> {
    return this.exerciseHistory;
  }

  setExerciseHistory(history: Record<string, ExerciseHistory>): void {
    this.exerciseHistory = history;
  }

  getBodyweightHistory(): BodyweightHistory | undefined {
    return this.bodyweightHistory;
  }

  setBodyweightHistory(history: BodyweightHistory): void {
    this.bodyweightHistory = history;
  }

  getCumulativeStats(): CumulativeStats {
    return this.cumulativeStats;
  }

  setCumulativeStats(stats: CumulativeStats): void {
    this.cumulativeStats = stats;
  }

  getUnlockedAchievementIds(): Set<string> {
    return this.unlockedAchievementIds;
  }

  setUnlockedAchievementIds(ids: Set<string>): void {
    this.unlockedAchievementIds = ids;
  }
}
