import { useCallback, useEffect, useMemo, useState } from "react";
import { createHeatmapRepository } from "../../storage/repositories/heatmapRepository.js";
import { useDatabase } from "../db/context.js";
import type { RecencyMapEntry } from "../../heatmap/views.js";

export interface UseMuscleHeatmapResult {
  entries: RecencyMapEntry[] | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

// Every muscle's current heat for the Progress tab's body diagram — same
// thin-hook-over-a-repository shape as useMuscleXp, just reading
// heatmapRepository (Layer 2) instead of derivedStateRepository. Not
// cached across mounts: like useMuscleXp, this is a once-per-screen-visit
// read, not a hot path (spec §14 task 20's "once per keystroke" bar for
// caching doesn't apply here).
export function useMuscleHeatmap(): UseMuscleHeatmapResult {
  const { db } = useDatabase();
  const heatmap = useMemo(() => createHeatmapRepository(db), [db]);
  const [entries, setEntries] = useState<RecencyMapEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await heatmap.getRecencyMap());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [heatmap]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}
