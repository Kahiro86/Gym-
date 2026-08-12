import { useCallback, useEffect, useState } from "react";
import { createDerivedStateRepository } from "../../storage/repositories/derivedStateRepository.js";
import { levelFromTotalXp } from "../../domain/progression.js";
import { totalMuscleXp } from "../xpTotals.js";
import { useDatabase } from "../db/context.js";
import type { GymDatabase } from "../../storage/db.js";
import type { LevelProgress } from "../../domain/progression.js";

// Layer 3 calls Layer 1's levelFromTotalXp() directly (never reimplements
// the curve), fed by the same muscleXpCache sum every reader of "lifetime
// XP" uses (xpTotals.ts). Exported so ActiveSessionScreen's finish handler
// can take one last authoritative reading imperatively — same reasoning as
// useSessionXp's fetchSessionXp — without waiting on a hook's own state.
export async function fetchLifetimeLevel(db: GymDatabase): Promise<LevelProgress> {
  const derived = createDerivedStateRepository(db);
  const muscleXp = await derived.getAllMuscleXp();
  return levelFromTotalXp(totalMuscleXp(muscleXp));
}

export interface UseLifetimeLevelResult {
  level: LevelProgress | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

// The player's overall level and progress toward the next one (Today tab,
// spec §14 task 13) — reads the same muscleXpCache the session summary's
// level-up moment (Task 12) and the Progress tab (Task 15) do, so all
// three always agree on "what level am I."
export function useLifetimeLevel(): UseLifetimeLevelResult {
  const { db } = useDatabase();
  const [level, setLevel] = useState<LevelProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setLevel(await fetchLifetimeLevel(db));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { level, loading, error, refresh };
}
