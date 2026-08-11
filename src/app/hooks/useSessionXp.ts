import { useCallback, useEffect, useMemo, useState } from "react";
import { createDerivedStateRepository } from "../../storage/repositories/derivedStateRepository.js";
import { createSessionExerciseRepository } from "../../storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../storage/repositories/setRepository.js";
import { toLoggedSet } from "../../storage/convert.js";
import { computeSessionXp } from "../../domain/xp.js";
import { useDatabase } from "../db/context.js";
import type { SessionXpResult } from "../../domain/types.js";

export interface UseSessionXpResult {
  xp: SessionXpResult | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

// The live XP breakdown for the in-progress session (spec §14 task 11) —
// Layer 3 calls Layer 1's computeSessionXp() directly (never
// reimplements the math), fed by a HistoryContext built the same way
// Layer 2's own cache rebuild does (derivedStateRepository), so this
// preview is exactly what a rebuild would produce for this session's
// sets. Best-effort only: it recomputes from whatever's persisted right
// now, not a running ledger, and callers must call refresh() themselves
// after any write that could change it — set/exercise hooks don't know
// this hook exists, so there's no way to invalidate it automatically
// (same reasoning as useSets/SetList needing to share one instance).
export function useSessionXp(sessionId: string | null): UseSessionXpResult {
  const { db } = useDatabase();
  const derived = useMemo(() => createDerivedStateRepository(db), [db]);
  const sessionExercises = useMemo(() => createSessionExerciseRepository(db), [db]);
  const sets = useMemo(() => createSetRepository(db), [db]);
  const [xp, setXp] = useState<SessionXpResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setXp(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [history, seRows] = await Promise.all([
        derived.getHistoryContextForSession(sessionId),
        sessionExercises.listBySession(sessionId),
      ]);
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
  }, [derived, sessionExercises, sets, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { xp, loading, error, refresh };
}
