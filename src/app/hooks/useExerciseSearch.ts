import { useEffect, useMemo, useState } from "react";
import { createExerciseRepository } from "../../storage/repositories/exerciseRepository.js";
import { useDatabase } from "../db/context.js";
import type { Exercise } from "../../domain/types.js";

export interface UseExerciseSearchResult {
  results: Exercise[];
  loading: boolean;
  error: Error | null;
}

const DEFAULT_LIMIT = 20;

// Backs the exercise-switching search sheet (Task 10). Re-queries on every
// keystroke rather than debouncing — exerciseRepository.search() runs
// against an in-memory index (§6.4), so the per-keystroke budget (§13,
// <50ms) is a query-speed problem, not a call-frequency one. Stale
// responses from a superseded query are dropped via the `cancelled` guard.
export function useExerciseSearch(query: string, limit: number = DEFAULT_LIMIT): UseExerciseSearchResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createExerciseRepository(db), [db]);
  const [results, setResults] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repo
      .search(query, limit)
      .then((found) => {
        if (cancelled) return;
        setResults(found);
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
  }, [repo, query, limit]);

  return { results, loading, error };
}
