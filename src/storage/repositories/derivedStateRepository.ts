import { toLoggedSet } from "../convert.js";
import { computeSessionXp } from "../../domain/xp.js";
import { MUSCLE_IDS } from "../../domain/muscles.js";
import { emptyExerciseHistory } from "../../domain/types.js";
import { ENGINE_VERSION } from "../db.js";
import type { GymDatabase } from "../db.js";
import type { MuscleId } from "../../domain/muscles.js";
import type { BodyweightHistory, ExerciseHistory } from "../../domain/types.js";
import type { PrSnapshot } from "./setRepository.js";
import type { SetRecord } from "../types.js";

export interface DerivedStateRepository {
  getMuscleXp(muscleId: MuscleId): Promise<number>;
  getAllMuscleXp(): Promise<Record<MuscleId, number>>;
  getPrSnapshot(exerciseId: string): Promise<PrSnapshot>;

  // Wipes and replays every non-deleted set through Layer 1, in session
  // order, to repopulate both caches from scratch. Pure/deterministic —
  // depends only on stored sessions/sets, not wall-clock time — so calling
  // it twice in a row with no writes in between produces identical caches
  // (spec §6's rebuild-is-a-no-op guarantee).
  rebuildDerivedState(): Promise<void>;

  // Call once at app startup: rebuilds only if the caches were never built
  // or were built under a since-bumped ENGINE_VERSION. Cheap no-op
  // otherwise (a single indexed read).
  ensureFresh(): Promise<void>;
}

// A week/day "bucket" index — any consistent, monotonic partition of the
// timeline works here since these only ever feed comparisons against other
// bucket values, never external calendars.
function dayBucket(epochMs: number): number {
  return Math.floor(epochMs / (24 * 60 * 60 * 1000));
}
function weekBucket(epochMs: number): number {
  return Math.floor(epochMs / (7 * 24 * 60 * 60 * 1000));
}

function emptyMuscleXp(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) record[muscle] = 0;
  return record;
}

// Layer 1's HistoryContext takes isFirstSessionOfDay/streakWeeks as opaque
// caller-supplied inputs — Layer 1 deliberately has no opinion on calendar
// semantics. This is where that opinion lives: a session is "first of day"
// if no earlier (chronologically) non-deleted session shares its day
// bucket, and streakWeeks counts the consecutive prior week buckets
// (immediately before this session's week, not including it) that also
// had a session. Both are pure functions of stored session timestamps, so
// rebuilds are fully reproducible.
async function replaySessions(db: GymDatabase) {
  const sessions = (await db.sessions.toArray())
    .filter((s) => s.deletedAt === null)
    .sort((a, b) => a.startedAt - b.startedAt);

  const allSets = await db.sets.toArray();
  const setsBySession = new Map<string, SetRecord[]>();
  for (const row of allSets) {
    if (row.deletedAt !== null) continue;
    const list = setsBySession.get(row.sessionId);
    if (list) list.push(row);
    else setsBySession.set(row.sessionId, [row]);
  }
  for (const list of setsBySession.values()) list.sort((a, b) => a.loggedAt - b.loggedAt);

  let exerciseHistory: Record<string, ExerciseHistory> = {};
  let bodyweightHistory: BodyweightHistory | undefined;
  const trainedDays = new Set<number>();
  const trainedWeeks = new Set<number>();
  const muscleXp = emptyMuscleXp();

  for (const session of sessions) {
    const setRows = setsBySession.get(session.id);
    if (!setRows || setRows.length === 0) continue;

    const thisDay = dayBucket(session.startedAt);
    const isFirstSessionOfDay = !trainedDays.has(thisDay);

    const thisWeek = weekBucket(session.startedAt);
    let streakWeeks = 0;
    for (let w = thisWeek - 1; trainedWeeks.has(w); w--) streakWeeks++;

    const result = computeSessionXp(
      { sets: setRows.map(toLoggedSet) },
      { exerciseHistory, bodyweightHistory, isFirstSessionOfDay, streakWeeks }
    );

    exerciseHistory = result.updatedExerciseHistory;
    bodyweightHistory = result.updatedBodyweightHistory;
    for (const muscle of MUSCLE_IDS) muscleXp[muscle] += result.muscleXp[muscle];

    trainedDays.add(thisDay);
    trainedWeeks.add(thisWeek);
  }

  return { exerciseHistory, muscleXp };
}

export function createDerivedStateRepository(db: GymDatabase): DerivedStateRepository {
  return {
    async getMuscleXp(muscleId) {
      const row = await db.muscleXpCache.get(muscleId);
      return row?.xp ?? 0;
    },

    async getAllMuscleXp() {
      const rows = await db.muscleXpCache.toArray();
      const result = emptyMuscleXp();
      for (const row of rows) result[row.muscleId] = row.xp;
      return result;
    },

    async getPrSnapshot(exerciseId) {
      const row = await db.prCache.get(exerciseId);
      if (!row) return emptyExerciseHistory();
      return { maxWeightKg: row.maxWeightKg, maxVolumeSingleSet: row.maxVolumeSingleSet, repsAtLoad: row.repsAtLoad };
    },

    async rebuildDerivedState() {
      const { exerciseHistory, muscleXp } = await replaySessions(db);

      await db.transaction("rw", db.prCache, db.muscleXpCache, async () => {
        await db.prCache.clear();
        await db.muscleXpCache.clear();

        await db.prCache.bulkAdd(
          Object.entries(exerciseHistory).map(([exerciseId, h]) => ({
            exerciseId,
            maxWeightKg: h.maxWeightKg,
            maxVolumeSingleSet: h.maxVolumeSingleSet,
            repsAtLoad: h.repsAtLoad,
            engineVersion: ENGINE_VERSION,
          }))
        );

        await db.muscleXpCache.bulkAdd(
          MUSCLE_IDS.map((muscleId) => ({ muscleId, xp: muscleXp[muscleId], engineVersion: ENGINE_VERSION }))
        );
      });
    },

    async ensureFresh() {
      const sample = await db.muscleXpCache.limit(1).toArray();
      const stale = sample.length === 0 || sample[0]!.engineVersion !== ENGINE_VERSION;
      if (stale) await this.rebuildDerivedState();
    },
  };
}
