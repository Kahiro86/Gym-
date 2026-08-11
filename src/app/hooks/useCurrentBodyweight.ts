import { useEffect, useMemo, useState } from "react";
import { createBodyweightRepository } from "../../storage/repositories/bodyweightRepository.js";
import { useDatabase } from "../db/context.js";

export interface UseCurrentBodyweightResult {
  bodyweightKg: number;
  loading: boolean;
  error: Error | null;
}

// getNearest(now) is the same "reconstruct what the user's bodyweight
// probably was" mechanism bodyweightRepository.ts already documents for
// defaulting a new set's bodyweightKgAtTime. Falls back to a population-
// average default when the user has never logged a weigh-in (e.g. skipped
// onboarding's bodyweight question) — logging a set never blocks on this.
const FALLBACK_BODYWEIGHT_KG = 70;

export function useCurrentBodyweight(): UseCurrentBodyweightResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createBodyweightRepository(db), [db]);
  const [bodyweightKg, setBodyweightKg] = useState(FALLBACK_BODYWEIGHT_KG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo
      .getNearest(Date.now())
      .then((entry) => {
        if (cancelled) return;
        setBodyweightKg(entry?.bodyweightKg ?? FALLBACK_BODYWEIGHT_KG);
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
  }, [repo]);

  return { bodyweightKg, loading, error };
}
