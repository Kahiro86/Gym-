import { useCallback, useEffect, useMemo, useState } from "react";
import { createProfileRepository, type ProfilePatch } from "../../storage/repositories/profileRepository.js";
import { useDatabase } from "../db/context.js";
import type { ProfileRecord } from "../../storage/types.js";

export interface UseProfileResult {
  profile: ProfileRecord | null;
  loading: boolean;
  error: Error | null;
  update(patch: ProfilePatch): Promise<ProfileRecord>;
  refresh(): Promise<void>;
}

// The synced (per-account) profile fields — height/birth date/sex — the
// Settings screen's Profile section reads and writes (spec §14 task 16).
export function useProfile(): UseProfileResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createProfileRepository(db), [db]);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProfile(await repo.get());
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

  const update = useCallback<UseProfileResult["update"]>(
    async (patch) => {
      const updated = await repo.update(patch);
      setProfile(updated);
      return updated;
    },
    [repo]
  );

  return { profile, loading, error, update, refresh };
}
