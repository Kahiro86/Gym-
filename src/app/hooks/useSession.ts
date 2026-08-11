import { useCallback, useEffect, useMemo, useState } from "react";
import { createSessionRepository, type StartupSessionCheck } from "../../storage/repositories/sessionRepository.js";
import { useDatabase } from "../db/context.js";
import type { SessionRecord } from "../../storage/types.js";

export interface UseSessionResult {
  // null while the startup check hasn't resolved yet; the resolved value
  // itself is null when there is no active session at all (§6.2).
  check: StartupSessionCheck | null;
  loading: boolean;
  error: Error | null;
  start(startedAt: number, options?: { note?: string | null; routineId?: string | null }): Promise<SessionRecord>;
  resume(id: string): Promise<SessionRecord>;
  finish(id: string, endedAt: number): Promise<void>;
  discard(id: string): Promise<void>;
  refresh(): Promise<void>;
}

// Wraps sessionRepository for the active/in-progress session: the startup
// resume-or-discard check (§6.2) plus the handful of lifecycle actions the
// UI can take. No optimistic UI (§2) — every action awaits its repository
// call, then refetches, before the hook's state moves.
export function useSession(): UseSessionResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createSessionRepository(db), [db]);
  const [check, setCheck] = useState<StartupSessionCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await repo.checkForActiveSession();
      setCheck(result);
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

  const start = useCallback<UseSessionResult["start"]>(
    async (startedAt, options) => {
      const session = await repo.create({ startedAt, note: options?.note, routineId: options?.routineId });
      await refresh();
      return session;
    },
    [repo, refresh]
  );

  const resume = useCallback<UseSessionResult["resume"]>(
    async (id) => {
      const session = await repo.resume(id);
      await refresh();
      return session;
    },
    [repo, refresh]
  );

  const finish = useCallback<UseSessionResult["finish"]>(
    async (id, endedAt) => {
      await repo.finish(id, endedAt);
      await refresh();
    },
    [repo, refresh]
  );

  const discard = useCallback<UseSessionResult["discard"]>(
    async (id) => {
      await repo.discard(id);
      await refresh();
    },
    [repo, refresh]
  );

  return { check, loading, error, start, resume, finish, discard, refresh };
}
