import { InMemoryMuscleRollupStore, applySessionToRollup } from "../../heatmap/store.js";
import { computeRecencyMap } from "../../heatmap/views.js";
import { toLoggedSet } from "../convert.js";
import type { GymDatabase } from "../db.js";
import type { RecencyMapEntry } from "../../heatmap/views.js";
import type { SessionExerciseRecord, SetRecord } from "../types.js";

export interface HeatmapRepository {
  // Every muscle's current heat (0-1, recency-weighted volume vs. its own
  // trailing 8-week average — see heatmap/views.ts §6.1), for the Progress
  // tab's body diagram (spec follow-up: heatmap UI). The math in
  // src/heatmap/ was written early (pre-Dexie) against an in-memory
  // MuscleRollupStore and never wired to real storage — this is that
  // wiring, not a reimplementation. No cardio input: the app has no
  // cardio-logging UI/repository yet, so every session is lifting-only.
  getRecencyMap(now?: number): Promise<RecencyMapEntry[]>;
}

// Same "completed, non-deleted sessions; completed, non-warmup, non-deleted
// sets" filter derivedStateRepository's replaySessions uses — a set that
// never happened (deleted) or doesn't count (warmup/failed) shouldn't heat
// a muscle. Grouped by session first (not one giant flat set list) because
// applySessionToRollup needs each session's own start time to pick its
// week bucket (§5: "a whole session lands in exactly one week bucket").
async function loadCompletedSessionSets(db: GymDatabase) {
  const sessions = (await db.sessions.toArray())
    .filter((s) => s.deletedAt === null && s.state === "completed")
    .sort((a, b) => a.startedAt - b.startedAt);

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

  return sessions.map((session) => {
    const sessionExerciseRows = sessionExercisesBySessionId.get(session.id) ?? [];
    const setRows = sessionExerciseRows.flatMap((se) => setsBySessionExerciseId.get(se.id) ?? []).sort((a, b) => a.loggedAt - b.loggedAt);
    return { session, sets: setRows.map(toLoggedSet) };
  });
}

export function createHeatmapRepository(db: GymDatabase): HeatmapRepository {
  return {
    async getRecencyMap(now = Date.now()) {
      const store = new InMemoryMuscleRollupStore();
      const sessionsWithSets = await loadCompletedSessionSets(db);
      for (const { sets } of sessionsWithSets) {
        if (sets.length === 0) continue;
        applySessionToRollup(store, { sets });
      }
      return computeRecencyMap(store, now);
    },
  };
}
