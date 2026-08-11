import { useEffect, useMemo, useState } from "react";
import { createExerciseRepository } from "../../storage/repositories/exerciseRepository.js";
import { useDatabase } from "../db/context.js";
import type { Exercise } from "../../domain/types.js";

export interface UseExerciseResult {
  exercise: Exercise | null;
  loading: boolean;
  error: Error | null;
}

// Resolves a single exercise by id — the logging screen needs an
// exercise's loadType to know which inputs to show (Task 6), and its
// name/muscles for display (Tasks 7/8/10). getById() deliberately
// resolves hidden custom exercises too (§6.5), so this never breaks for a
// set logged against an exercise the user has since removed from search.
export function useExercise(exerciseId: string | null): UseExerciseResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createExerciseRepository(db), [db]);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!exerciseId) {
      setExercise(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    repo
      .getById(exerciseId)
      .then((found) => {
        if (cancelled) return;
        setExercise(found);
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
  }, [repo, exerciseId]);

  return { exercise, loading, error };
}
