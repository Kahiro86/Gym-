import { useSessionHistory } from "../hooks/useSessionHistory.js";
import { HistoryRow } from "../history/HistoryRow.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import styles from "./HistoryScreen.module.css";

// Past sessions, newest first (spec §14 task 14) — a flat, paginated list
// rather than infinite scroll, so "load more" stays a plain, testable
// button tap instead of an IntersectionObserver.
export function HistoryScreen() {
  const { entries, loading, loadingMore, hasMore, loadMore } = useSessionHistory();

  return (
    <div className={styles.screen}>
      <h1>History</h1>

      {!loading && entries.length === 0 && <EmptyState title="No sessions yet" description="Finish a workout to see it here." />}

      <ul className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.session.id}>
            <HistoryRow entry={entry} />
          </li>
        ))}
      </ul>

      {hasMore && (
        <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
