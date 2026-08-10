import { computeSessionXp } from "../domain/xp.js";
import { aggregateSessionTotals } from "../domain/aggregate.js";
import { levelFromTotalXp } from "../domain/progression.js";
import { resolveAchievementRewards } from "../domain/achievements.js";
import { emptyBodyweightHistory } from "../domain/types.js";
import { MUSCLE_IDS } from "../domain/muscles.js";
import { dayStartFor } from "../shared/dates.js";
import { computeStreakWeeks } from "./streak.js";
import { emptyCumulativeStats } from "./inMemoryStore.js";
import type { BodyweightHistory, ExerciseHistory, HistoryContext, MuscleId, Pr, PrType } from "../domain/types.js";
import type { PlayerStats, UnlockedAchievement } from "../domain/achievements.js";
import type { CumulativeStats, GymStore, StoredSession } from "./types.js";

// Write path for the general persistence layer. Every write (new session,
// edited session, deleted session) replays the *entire* session history
// from scratch rather than patching incrementally — exercise PR history
// and cumulative achievement state are inherently sequential (order-
// dependent), so an edit to an old session has to flow forward through
// everything after it. Same "recompute, don't incrementally patch"
// philosophy heatmap/store.ts uses for its cardio cap, just applied to
// the whole session log instead of one week. This runs once per write,
// not per render — the "don't recompute on render" caution doesn't apply.

export interface LogSessionResult {
  sessionId: string;
  xp: ReturnType<typeof computeSessionXp>;
  unlockedAchievements: UnlockedAchievement[];
  level: number;
  leveledUp: boolean;
}

interface DerivedState {
  exerciseHistory: Record<string, ExerciseHistory>;
  bodyweightHistory: BodyweightHistory | undefined;
  cumulativeStats: CumulativeStats;
  unlockedAchievementIds: Set<string>;
}

function emptyDerivedState(): DerivedState {
  return {
    exerciseHistory: {},
    bodyweightHistory: undefined,
    cumulativeStats: emptyCumulativeStats(),
    unlockedAchievementIds: new Set(),
  };
}

function isFirstOfDay(priorSessions: StoredSession[], loggedAt: number): boolean {
  const day = dayStartFor(loggedAt);
  return !priorSessions.some((s) => dayStartFor(s.loggedAt) === day);
}

function mergeMuscleXp(a: Record<MuscleId, number>, b: Record<MuscleId, number>): Record<MuscleId, number> {
  const result = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) result[muscle] = a[muscle] + b[muscle];
  return result;
}

function mergePrCounts(a: Record<PrType, number>, prs: Pr[]): Record<PrType, number> {
  const result = { ...a };
  for (const pr of prs) result[pr.type] += 1;
  return result;
}

function applySession(
  state: DerivedState,
  session: StoredSession,
  priorSessions: StoredSession[]
): { state: DerivedState; xp: ReturnType<typeof computeSessionXp>; unlockedAchievements: UnlockedAchievement[] } {
  const history: HistoryContext = {
    exerciseHistory: state.exerciseHistory,
    bodyweightHistory: state.bodyweightHistory,
    isFirstSessionOfDay: isFirstOfDay(priorSessions, session.loggedAt),
    streakWeeks: computeStreakWeeks(priorSessions, session.loggedAt),
  };

  const xp = computeSessionXp({ sets: session.sets }, history);
  const sessionVolume = aggregateSessionTotals(session.sets).totalVolume;

  const nextCumulative: CumulativeStats = {
    totalXp: state.cumulativeStats.totalXp + xp.total,
    totalSessions: state.cumulativeStats.totalSessions + 1,
    totalSets: state.cumulativeStats.totalSets + session.sets.length,
    totalVolume: state.cumulativeStats.totalVolume + sessionVolume,
    muscleXp: mergeMuscleXp(state.cumulativeStats.muscleXp, xp.muscleXp),
    prCounts: mergePrCounts(state.cumulativeStats.prCounts, xp.prs),
  };

  const statsForAchievements: PlayerStats = {
    ...nextCumulative,
    level: levelFromTotalXp(nextCumulative.totalXp).level,
    streakWeeks: history.streakWeeks,
  };
  const rewardResult = resolveAchievementRewards(statsForAchievements, state.unlockedAchievementIds);
  nextCumulative.totalXp = rewardResult.finalTotalXp;

  const nextUnlockedIds = new Set(state.unlockedAchievementIds);
  for (const unlocked of rewardResult.unlocked) nextUnlockedIds.add(unlocked.achievementId);

  return {
    state: {
      exerciseHistory: xp.updatedExerciseHistory,
      bodyweightHistory: xp.updatedBodyweightHistory,
      cumulativeStats: nextCumulative,
      unlockedAchievementIds: nextUnlockedIds,
    },
    xp,
    unlockedAchievements: rewardResult.unlocked,
  };
}

// Replays every stored session (chronological) from a blank slate and
// writes the resulting derived state back to the store. If targetSessionId
// is given, returns that specific session's own result (its XP breakdown,
// achievements it unlocked, and its level transition) — independent of
// what any later sessions in the replay do.
function replay(store: GymStore, targetSessionId?: string): LogSessionResult | undefined {
  const sessions = store.listSessions();
  let state = emptyDerivedState();
  let targetResult: LogSessionResult | undefined;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    const priorSessions = sessions.slice(0, i);
    const levelBefore = levelFromTotalXp(state.cumulativeStats.totalXp).level;

    const applied = applySession(state, session, priorSessions);
    const levelAfter = levelFromTotalXp(applied.state.cumulativeStats.totalXp).level;

    if (session.id === targetSessionId) {
      targetResult = {
        sessionId: session.id,
        xp: applied.xp,
        unlockedAchievements: applied.unlockedAchievements,
        level: levelAfter,
        leveledUp: levelAfter > levelBefore,
      };
    }

    state = applied.state;
  }

  store.setExerciseHistory(state.exerciseHistory);
  store.setBodyweightHistory(state.bodyweightHistory ?? emptyBodyweightHistory());
  store.setCumulativeStats(state.cumulativeStats);
  store.setUnlockedAchievementIds(state.unlockedAchievementIds);

  return targetResult;
}

// Logs a brand-new session, or edits one already stored under the same id
// (upsert semantics) — either way, the store ends up fully recomputed and
// the result reflects that specific session.
export function logSession(store: GymStore, session: StoredSession): LogSessionResult {
  store.upsertSession(session);
  const result = replay(store, session.id);
  if (!result) {
    throw new Error(`logSession: session "${session.id}" was not found in the replay — this should be unreachable`);
  }
  return result;
}

export function deleteSession(store: GymStore, sessionId: string): void {
  store.deleteSession(sessionId);
  replay(store);
}

// Exposed for callers who want to force a recompute without any write
// (e.g. after directly manipulating a persistence backend out of band).
export function recomputeAll(store: GymStore): void {
  replay(store);
}
