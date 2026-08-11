import { useEffect, useMemo, useState } from "react";
import { createSetRepository } from "../../storage/repositories/setRepository.js";
import { useDatabase } from "../db/context.js";
import type { SessionRecord, SetRecord } from "../../storage/types.js";

export interface LastPerformance {
  session: SessionRecord;
  sets: SetRecord[];
}

export interface UseLastPerformanceResult {
  lastPerformance: LastPerformance | null;
  loading: boolean;
  error: Error | null;
}

// "What did I do last time" (spec §14 task 7) — setRepository.lastPerformance
// already excludes warmups/failed attempts and, via beforeSessionId, the
// current session itself, so this only ever shows real prior performance.
export function useLastPerformance(exerciseId: string | null, beforeSessionId?: string): UseLastPerformanceResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createSetRepository(db), [db]);
  const [lastPerformance, setLastPerformance] = useState<LastPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!exerciseId) {
      setLastPerformance(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    repo
      .lastPerformance(exerciseId, beforeSessionId)
      .then((result) => {
        if (cancelled) return;
        setLastPerformance(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, exerciseId, beforeSessionId]);

  return { lastPerformance, loading, error };
}
