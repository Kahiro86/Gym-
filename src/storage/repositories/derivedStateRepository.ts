import { toLoggedSet } from "../convert.js";
import { captureTzOffsetMinutes, localDayIndex, localWeekIndex } from "../time.js";
import { computeSessionXp } from "../../domain/xp.js";
import { MUSCLE_IDS } from "../../domain/muscles.js";
import { emptyExerciseHistory } from "../../domain/types.js";
import { ENGINE_VERSION } from "../db.js";
import type { GymDatabase } from "../db.js";
import type { MuscleId } from "../../domain/muscles.js";
import type { BodyweightHistory, ExerciseHistory, HistoryContext } from "../../domain/types.js";
import type { PrSnapshot } from "./setRepository.js";
import type { SessionExerciseRecord, SetRecord } from "../types.js";

export interface RebuildProgress {
  processedSessions: number;
  totalSessions: number;
}

export interface DerivedStateRepository {
  getMuscleXp(muscleId: MuscleId): Promise<number>;
  getAllMuscleXp(): Promise<Record<MuscleId, number>>;
  getPrSnapshot(exerciseId: string): Promise<PrSnapshot>;

  // Replays every non-deleted, completed, non-warmup set through Layer 1,
  // in session order, to repopulate both caches from scratch. [v2] §7:
  // bounded and chunked — the new state is computed fully in memory
  // first (yielding to the event loop between chunks so a long rebuild
  // never blocks a real UI's main thread) and the cache tables are only
  // touched in one fast transaction at the very end, so readers see
  // either the fully stale-but-usable old state or the fully fresh new
  // one, never a half-cleared table mid-rebuild. Never awaited
  // synchronously on app start — call in the background and let
  // ensureFresh()'s caller decide when that matters.
  rebuildDerivedState(onProgress?: (progress: RebuildProgress) => void): Promise<void>;

  // Call once at app startup: rebuilds only if the caches were never
  // built or were built under a since-bumped ENGINE_VERSION. Cheap no-op
  // otherwise (a single indexed read).
  ensureFresh(onProgress?: (progress: RebuildProgress) => void): Promise<void>;

  // The exact HistoryContext computeSessionXp() needs to score `sessionId`'s
  // own sets (Task 11's live XP breakdown) — built by replaying every
  // session that started before it, so exerciseHistory reflects state as
  // of just before this one began. Deliberately not sourced from
  // prCache/muscleXpCache: those only refresh on a full rebuild and
  // getPrSnapshot() can't distinguish "never logged" from "logged with
  // empty stats" (a real row vs. no row at all), which HistoryContext's
  // own contract requires (key absence = first-ever, see types.ts).
  // Costs the same as a full rebuild in the worst case (proportional to
  // total session count so far) but is only ever called for the one
  // active session at a time, not per keystroke.
  getHistoryContextForSession(sessionId: string): Promise<HistoryContext>;

  // How many consecutive Monday-start weeks (current device timezone,
  // spec §4) have had a completed session, counting up to and including
  // this week if it's already been trained. Same trainedWeeks bookkeeping
  // replaySessions always does internally — this just reads it back
  // relative to "now" instead of stopping at a specific session. Not
  // cached: like getHistoryContextForSession, it's only ever called for
  // one screen at a time, not per keystroke.
  getCurrentStreakWeeks(now?: number): Promise<number>;
}

const CHUNK_SIZE = 50;

function emptyMuscleXp(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) record[muscle] = 0;
  return record;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Layer 1's HistoryContext takes isFirstSessionOfDay/streakWeeks as opaque
// caller-supplied inputs — this is where that calendar opinion lives,
// using each session's own captured tzOffsetMinutes (time.ts) rather than
// the device's current one, so a rebuild is stable across relocation just
// like the original write-time classification would have been.
//
// No bodyweight-log lookup happens here at all: bodyweightKgAtTime is
// denormalized onto every SetRecord already (§5.3), so there is no O(n)
// getNearest-per-set cost to avoid in the first place — the schema
// already avoids it by construction, which is stronger than making each
// lookup O(log n).
interface ReplayOptions {
  onProgress?: (progress: RebuildProgress) => void;
  // Stops just before this session's own sets are folded in, capturing
  // the HistoryContext at exactly that point instead of continuing to
  // the end. Sessions at or after it are never touched.
  stopBeforeSessionId?: string;
}

async function replaySessions(db: GymDatabase, options: ReplayOptions = {}) {
  const { onProgress, stopBeforeSessionId } = options;
  const sessions = (await db.sessions.toArray()).filter((s) => s.deletedAt === null).sort((a, b) => a.startedAt - b.startedAt);

  // Pre-fetch and group once — many small per-session queries would
  // dominate cost far more than the in-memory replay itself.
  const sessionExercisesBySessionId = new Map<string, SessionExerciseRecord[]>();
  for (const se of await db.sessionExercises.toArray()) {
    if (se.deletedAt !== null) continue;
    const list = sessionExercisesBySessionId.get(se.sessionId);
    if (list) list.push(se);
    else sessionExercisesBySessionId.set(se.sessionId, [se]);
  }

  const setsBySessionExerciseId = new Map<string, SetRecord[]>();
  for (const row of await db.sets.toArray()) {
    if (row.deletedAt !== null || !row.completed || row.isWarmup) continue;
    const list = setsBySessionExerciseId.get(row.sessionExerciseId);
    if (list) list.push(row);
    else setsBySessionExerciseId.set(row.sessionExerciseId, [row]);
  }

  let exerciseHistory: Record<string, ExerciseHistory> = {};
  let bodyweightHistory: BodyweightHistory | undefined;
  const trainedDays = new Set<number>();
  const trainedWeeks = new Set<number>();
  const muscleXp = emptyMuscleXp();
  let historyContextForStoppedSession: HistoryContext | undefined;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;

    if (session.id === stopBeforeSessionId) {
      const thisDay = localDayIndex(session.startedAt, session.tzOffsetMinutes);
      const thisWeek = localWeekIndex(session.startedAt, session.tzOffsetMinutes);
      let streakWeeks = 0;
      for (let w = thisWeek - 1; trainedWeeks.has(w); w--) streakWeeks++;
      historyContextForStoppedSession = {
        exerciseHistory,
        bodyweightHistory,
        isFirstSessionOfDay: !trainedDays.has(thisDay),
        streakWeeks,
      };
      break;
    }

    const sessionExerciseRows = sessionExercisesBySessionId.get(session.id) ?? [];
    const setRows = sessionExerciseRows
      .flatMap((se) => setsBySessionExerciseId.get(se.id) ?? [])
      .sort((a, b) => a.loggedAt - b.loggedAt);

    if (setRows.length > 0) {
      const thisDay = localDayIndex(session.startedAt, session.tzOffsetMinutes);
      const isFirstSessionOfDay = !trainedDays.has(thisDay);

      const thisWeek = localWeekIndex(session.startedAt, session.tzOffsetMinutes);
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

    if ((i + 1) % CHUNK_SIZE === 0 || i === sessions.length - 1) {
      onProgress?.({ processedSessions: i + 1, totalSessions: sessions.length });
      await sleep(0); // yield to the event loop between chunks
    }
  }

  return { exerciseHistory, muscleXp, historyContextForStoppedSession, trainedWeeks };
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

    async rebuildDerivedState(onProgress) {
      const { exerciseHistory, muscleXp } = await replaySessions(db, { onProgress });

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

    async ensureFresh(onProgress) {
      const sample = await db.muscleXpCache.limit(1).toArray();
      const stale = sample.length === 0 || sample[0]!.engineVersion !== ENGINE_VERSION;
      if (stale) await this.rebuildDerivedState(onProgress);
    },

    async getHistoryContextForSession(sessionId) {
      const session = await db.sessions.get(sessionId);
      if (!session || session.deletedAt !== null) {
        throw new Error(`Cannot build a history context for session ${sessionId} — it does not exist or has been deleted.`);
      }
      const { historyContextForStoppedSession } = await replaySessions(db, { stopBeforeSessionId: sessionId });
      // The existence check above guarantees replaySessions finds this
      // session in its own list and hits the stop branch (even a
      // chronologically-first session does — trainedDays/trainedWeeks are
      // just still empty then) — this fallback only exists to satisfy the
      // return type, it's unreachable in practice.
      return (
        historyContextForStoppedSession ?? {
          exerciseHistory: {},
          bodyweightHistory: undefined,
          isFirstSessionOfDay: true,
          streakWeeks: 0,
        }
      );
    },

    async getCurrentStreakWeeks(now = Date.now()) {
      const { trainedWeeks } = await replaySessions(db);
      const thisWeek = localWeekIndex(now, captureTzOffsetMinutes(now));

      let streakWeeks = trainedWeeks.has(thisWeek) ? 1 : 0;
      for (let w = thisWeek - 1; trainedWeeks.has(w); w--) streakWeeks++;
      return streakWeeks;
    },
  };
}
