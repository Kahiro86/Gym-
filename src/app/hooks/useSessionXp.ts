import { useCallback, useEffect, useRef, useState } from "react";
import { createDerivedStateRepository } from "../../storage/repositories/derivedStateRepository.js";
import { createSessionExerciseRepository } from "../../storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../storage/repositories/setRepository.js";
import { toLoggedSet } from "../../storage/convert.js";
import { computeSessionXp } from "../../domain/xp.js";
import { useDatabase } from "../db/context.js";
import type { GymDatabase } from "../../storage/db.js";
import type { HistoryContext, SessionXpResult } from "../../domain/types.js";

export interface UseSessionXpResult {
  xp: SessionXpResult | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

// Layer 3 calls Layer 1's computeSessionXp() directly (never reimplements
// the math), fed by a HistoryContext built the same way Layer 2's own
// cache rebuild does (derivedStateRepository) — so this is exactly what a
// rebuild would produce for this session's sets right now. Exported (not
// just used internally by the hook below) so ActiveSessionScreen's finish
// handler can compute one last authoritative reading imperatively, without
// racing a hook's own state update the way reading `xp` after calling
// `refresh()` would (see the finish handler's own note), and so
// useLastCompletedSession can compute a past session's total once without
// needing the live hook's per-sessionId caching below (a one-shot read
// doesn't benefit from a cache that only pays off across repeated calls).
export async function fetchSessionXp(db: GymDatabase, sessionId: string): Promise<SessionXpResult> {
  const derived = createDerivedStateRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const sets = createSetRepository(db);

  const [history, seRows] = await Promise.all([derived.getHistoryContextForSession(sessionId), sessionExercises.listBySession(sessionId)]);
  const setRowsBySe = await Promise.all(seRows.map((se) => sets.listBySessionExercise(se.id)));
  const loggedSets = setRowsBySe
    .flat()
    .filter((set) => set.completed && !set.isWarmup)
    .sort((a, b) => a.loggedAt - b.loggedAt)
    .map(toLoggedSet);

  return computeSessionXp({ sets: loggedSets }, history);
}

// The live XP breakdown for the in-progress session (spec §14 task 11).
// Best-effort only: it recomputes from whatever's persisted right now, not
// a running ledger, and callers must call refresh() themselves after any
// write that could change it — set/exercise hooks don't know this hook
// exists, so there's no way to invalidate it automatically (same reasoning
// as useSets/SetList needing to share one instance).
export function useSessionXp(sessionId: string | null): UseSessionXpResult {
  const { db } = useDatabase();
  const [xp, setXp] = useState<SessionXpResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // getHistoryContextForSession() replays every session that started
  // before this one — real work for a long training history, and fixed
  // for as long as this session stays open (no *earlier* session can
  // retroactively change while the user is mid-workout). refresh() fires
  // after every set logged, deleted, or undone during that workout (spec
  // §14 task 20), so without this cache each keystroke would re-pay the
  // full replay cost just to re-derive the same unchanged prior history.
  const historyContextCache = useRef<{ db: GymDatabase; sessionId: string; context: HistoryContext } | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setXp(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const derived = createDerivedStateRepository(db);
      const sessionExercises = createSessionExerciseRepository(db);
      const sets = createSetRepository(db);

      const cached = historyContextCache.current;
      const history =
        cached && cached.db === db && cached.sessionId === sessionId
          ? cached.context
          : await derived.getHistoryContextForSession(sessionId);
      historyContextCache.current = { db, sessionId, context: history };

      const seRows = await sessionExercises.listBySession(sessionId);
      const setRowsBySe = await Promise.all(seRows.map((se) => sets.listBySessionExercise(se.id)));
      const loggedSets = setRowsBySe
        .flat()
        .filter((set) => set.completed && !set.isWarmup)
        .sort((a, b) => a.loggedAt - b.loggedAt)
        .map(toLoggedSet);

      setXp(computeSessionXp({ sets: loggedSets }, history));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [db, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { xp, loading, error, refresh };
}
