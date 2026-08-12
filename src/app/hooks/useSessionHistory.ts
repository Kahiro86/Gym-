import { useCallback, useEffect, useMemo, useState } from "react";
import { createSessionRepository } from "../../storage/repositories/sessionRepository.js";
import { createDerivedStateRepository } from "../../storage/repositories/derivedStateRepository.js";
import { useDatabase } from "../db/context.js";
import type { SessionRecord } from "../../storage/types.js";
import type { SessionXpResult } from "../../domain/types.js";

export interface HistoryEntry {
  session: SessionRecord;
  // null for a session with no completed sets (e.g. abandoned before
  // logging anything) — same key-absence convention
  // listSessionXpTotals() itself uses.
  xp: SessionXpResult | null;
}

export interface UseSessionHistoryResult {
  entries: HistoryEntry[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
}

const PAGE_SIZE = 20;

// Past sessions, newest first, paginated (History tab, spec §14 task 14).
// listSessionXpTotals() is fetched once per refresh() and reused across
// every loadMore() page — it already computes every session's xp in one
// replay, so re-fetching it per page would throw that saving away.
export function useSessionHistory(): UseSessionHistoryResult {
  const { db } = useDatabase();
  const sessions = useMemo(() => createSessionRepository(db), [db]);
  const derived = useMemo(() => createDerivedStateRepository(db), [db]);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [xpTotals, setXpTotals] = useState<Map<string, SessionXpResult> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const toEntries = useCallback(
    (rows: SessionRecord[], totals: Map<string, SessionXpResult>): HistoryEntry[] =>
      rows.map((session) => ({ session, xp: totals.get(session.id) ?? null })),
    []
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, totals] = await Promise.all([sessions.listRecent(PAGE_SIZE + 1), derived.listSessionXpTotals()]);
      setXpTotals(totals);
      setHasMore(rows.length > PAGE_SIZE);
      setEntries(toEntries(rows.slice(0, PAGE_SIZE), totals));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [sessions, derived, toEntries]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || entries.length === 0 || !xpTotals) return;
    setLoadingMore(true);
    try {
      const before = entries[entries.length - 1]!.session.startedAt;
      const rows = await sessions.listRecent(PAGE_SIZE + 1, before);
      setHasMore(rows.length > PAGE_SIZE);
      setEntries((prev) => [...prev, ...toEntries(rows.slice(0, PAGE_SIZE), xpTotals)]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, entries, xpTotals, sessions, toEntries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, loadingMore, hasMore, error, loadMore, refresh };
}
