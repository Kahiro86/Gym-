import { useCallback, useEffect, useMemo, useState } from "react";
import { createDerivedStateRepository } from "../../storage/repositories/derivedStateRepository.js";
import { useDatabase } from "../db/context.js";

export interface UseCurrentStreakResult {
  streakWeeks: number | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

// The player's current weekly training streak (Today tab, spec §14 task
// 13) — consecutive Monday-start weeks with a completed session, counting
// this week once it's been trained. Not cached: like
// getHistoryContextForSession, it's a full replay each call, but this
// screen is only ever visited by a human, not per keystroke.
export function useCurrentStreak(): UseCurrentStreakResult {
  const { db } = useDatabase();
  const derived = useMemo(() => createDerivedStateRepository(db), [db]);
  const [streakWeeks, setStreakWeeks] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStreakWeeks(await derived.getCurrentStreakWeeks());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [derived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { streakWeeks, loading, error, refresh };
}
