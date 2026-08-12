import { useDatabase } from "./context.js";
import styles from "./DegradedBanner.module.css";

// A persistent, non-dismissing warning (spec §14 task 18) — unlike the
// toast system's auto-expiring messages, this describes an ongoing
// condition for the rest of the session (IndexedDB was unavailable and
// `db` is running on the in-memory fallback, §3.1), so it stays visible
// the whole time it's true rather than showing once and disappearing.
export function DegradedBanner() {
  const { degraded } = useDatabase();

  if (!degraded) return null;

  return (
    <div className={styles.banner} role="alert">
      Storage is unavailable on this device — nothing you log will be saved after you close this tab.
    </div>
  );
}
