import { useCallback, useEffect, useMemo, useState } from "react";
import { createSetRepository, type NewSet } from "../../storage/repositories/setRepository.js";
import { useDatabase } from "../db/context.js";
import type { SetRecord } from "../../storage/types.js";

export interface UseSetsResult {
  sets: SetRecord[];
  loading: boolean;
  error: Error | null;
  log(input: NewSet): Promise<SetRecord>;
  update(id: string, patch: Partial<NewSet>): Promise<SetRecord>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
}

// Wraps setRepository for one sessionExercise slot — the logging screen's
// core data source (Tasks 6-7). `sessionExerciseId` is nullable so callers
// can mount this before an exercise slot exists yet without a conditional
// hook call.
export function useSets(sessionExerciseId: string | null): UseSetsResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createSetRepository(db), [db]);
  const [sets, setSets] = useState<SetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionExerciseId) {
      setSets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSets(await repo.listBySessionExercise(sessionExerciseId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repo, sessionExerciseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const log = useCallback<UseSetsResult["log"]>(
    async (input) => {
      const record = await repo.log(input);
      await refresh();
      return record;
    },
    [repo, refresh]
  );

  const update = useCallback<UseSetsResult["update"]>(
    async (id, patch) => {
      const record = await repo.update(id, patch);
      await refresh();
      return record;
    },
    [repo, refresh]
  );

  const remove = useCallback<UseSetsResult["remove"]>(
    async (id) => {
      await repo.softDelete(id);
      await refresh();
    },
    [repo, refresh]
  );

  return { sets, loading, error, log, update, remove, refresh };
}
