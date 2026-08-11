import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoutineRepository, type NewRoutine } from "../../storage/repositories/routineRepository.js";
import { useDatabase } from "../db/context.js";
import type { RoutineRecord } from "../../storage/types.js";

export interface UseRoutinesResult {
  routines: RoutineRecord[];
  loading: boolean;
  error: Error | null;
  create(input: NewRoutine): Promise<RoutineRecord>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
}

// Backs the Start sheet's routines list (Task 5) and the routines editor
// (Task 16). Name-sorted, same as routineRepository.list() itself.
export function useRoutines(): UseRoutinesResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createRoutineRepository(db), [db]);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRoutines(await repo.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback<UseRoutinesResult["create"]>(
    async (input) => {
      const routine = await repo.create(input);
      await refresh();
      return routine;
    },
    [repo, refresh]
  );

  const remove = useCallback<UseRoutinesResult["remove"]>(
    async (id) => {
      await repo.softDelete(id);
      await refresh();
    },
    [repo, refresh]
  );

  return { routines, loading, error, create, remove, refresh };
}
