import { useCallback, useEffect, useMemo, useState } from "react";
import { createSessionExerciseRepository, type NewSessionExercise } from "../../storage/repositories/sessionExerciseRepository.js";
import { useDatabase } from "../db/context.js";
import type { SessionExerciseRecord } from "../../storage/types.js";

export interface UseSessionExercisesResult {
  sessionExercises: SessionExerciseRecord[];
  loading: boolean;
  error: Error | null;
  add(input: NewSessionExercise): Promise<SessionExerciseRecord>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
}

// Backs the logging screen's exercise list (Task 7) — order-index sorted,
// same as sessionExerciseRepository.listBySession() itself.
export function useSessionExercises(sessionId: string | null): UseSessionExercisesResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createSessionExerciseRepository(db), [db]);
  const [sessionExercises, setSessionExercises] = useState<SessionExerciseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSessionExercises([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSessionExercises(await repo.listBySession(sessionId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repo, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback<UseSessionExercisesResult["add"]>(
    async (input) => {
      const record = await repo.add(input);
      await refresh();
      return record;
    },
    [repo, refresh]
  );

  const remove = useCallback<UseSessionExercisesResult["remove"]>(
    async (id) => {
      await repo.softDelete(id);
      await refresh();
    },
    [repo, refresh]
  );

  return { sessionExercises, loading, error, add, remove, refresh };
}
