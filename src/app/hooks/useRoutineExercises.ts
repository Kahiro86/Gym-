import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoutineExerciseRepository, type NewRoutineExercise } from "../../storage/repositories/routineRepository.js";
import { useDatabase } from "../db/context.js";
import type { RoutineExerciseRecord } from "../../storage/types.js";

export interface UseRoutineExercisesResult {
  routineExercises: RoutineExerciseRecord[];
  loading: boolean;
  error: Error | null;
  add(input: NewRoutineExercise): Promise<RoutineExerciseRecord>;
  update(id: string, patch: Partial<NewRoutineExercise>): Promise<RoutineExerciseRecord>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
}

// Backs the routines editor's exercise list (spec §14 task 16) —
// order-index sorted, same as routineExerciseRepository.listByRoutine()
// itself. No reorder() here: the editor doesn't offer drag-to-reorder yet,
// same scope cut as the rest of this task (see RoutineDetailScreen).
export function useRoutineExercises(routineId: string | null): UseRoutineExercisesResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createRoutineExerciseRepository(db), [db]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!routineId) {
      setRoutineExercises([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRoutineExercises(await repo.listByRoutine(routineId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repo, routineId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback<UseRoutineExercisesResult["add"]>(
    async (input) => {
      const record = await repo.add(input);
      await refresh();
      return record;
    },
    [repo, refresh]
  );

  const update = useCallback<UseRoutineExercisesResult["update"]>(
    async (id, patch) => {
      const record = await repo.update(id, patch);
      await refresh();
      return record;
    },
    [repo, refresh]
  );

  const remove = useCallback<UseRoutineExercisesResult["remove"]>(
    async (id) => {
      await repo.softDelete(id);
      await refresh();
    },
    [repo, refresh]
  );

  return { routineExercises, loading, error, add, update, remove, refresh };
}
