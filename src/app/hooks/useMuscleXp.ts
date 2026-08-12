import { useCallback, useEffect, useMemo, useState } from "react";
import { createDerivedStateRepository } from "../../storage/repositories/derivedStateRepository.js";
import { useDatabase } from "../db/context.js";
import type { MuscleId } from "../../domain/muscles.js";

export interface UseMuscleXpResult {
  muscleXp: Record<MuscleId, number> | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

// Per-muscle lifetime XP (Progress tab, spec §14 task 15) — a thin read of
// the same muscleXpCache useLifetimeLevel sums for the overall level, kept
// as a separate hook since most screens only need one or the other.
export function useMuscleXp(): UseMuscleXpResult {
  const { db } = useDatabase();
  const derived = useMemo(() => createDerivedStateRepository(db), [db]);
  const [muscleXp, setMuscleXp] = useState<Record<MuscleId, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMuscleXp(await derived.getAllMuscleXp());
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

  return { muscleXp, loading, error, refresh };
}
