import { useCallback, useEffect, useMemo, useState } from "react";
import { createSessionRepository } from "../../storage/repositories/sessionRepository.js";
import { fetchSessionXp } from "./useSessionXp.js";
import { useDatabase } from "../db/context.js";
import type { SessionRecord } from "../../storage/types.js";
import type { SessionXpResult } from "../../domain/types.js";

export interface LastSession {
  session: SessionRecord;
  xp: SessionXpResult;
}

export interface UseLastCompletedSessionResult {
  lastSession: LastSession | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

const SCAN_BATCH = 10;
const MAX_BATCHES = 20; // a generous bound against a history that's mostly discarded/abandoned sessions

// The most recently *completed* session and what it earned (Today tab,
// spec §14 task 13). listRecent() also surfaces in_progress/abandoned
// sessions — useSession/StartScreen already own showing those — so this
// scans back in small batches until it finds one that actually finished
// with logged sets, then reuses Task 12's fetchSessionXp to recompute
// exactly what it earned.
export function useLastCompletedSession(): UseLastCompletedSessionResult {
  const { db } = useDatabase();
  const sessions = useMemo(() => createSessionRepository(db), [db]);
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let before: number | undefined;
      let found: SessionRecord | null = null;
      for (let i = 0; i < MAX_BATCHES && !found; i++) {
        const batch = await sessions.listRecent(SCAN_BATCH, before);
        if (batch.length === 0) break;
        found = batch.find((s) => s.state === "completed") ?? null;
        before = batch[batch.length - 1]!.startedAt;
      }
      setLastSession(found ? { session: found, xp: await fetchSessionXp(db, found.id) } : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [db, sessions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { lastSession, loading, error, refresh };
}
