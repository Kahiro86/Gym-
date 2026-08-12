import { Card } from "../ui/Card.js";
import { EmptyState } from "../ui/EmptyState.js";
import { formatRelativeDay } from "../formatRelativeDay.js";
import styles from "./LastWorkoutCard.module.css";
import type { LastSession } from "../hooks/useLastCompletedSession.js";

export interface LastWorkoutCardProps {
  lastSession: LastSession | null;
}

// A recap of the most recent completed workout (Today tab, spec §14 task
// 13) — date, XP earned, and PR count, reusing the same fetchSessionXp()
// reading the session summary screen (Task 12) is built from.
export function LastWorkoutCard({ lastSession }: LastWorkoutCardProps) {
  if (!lastSession) {
    return <EmptyState title="No workouts yet" description="Start your first session to see it here." />;
  }

  const { session, xp } = lastSession;

  return (
    <Card className={styles.card}>
      <span className={styles.date}>{formatRelativeDay(session.startedAt)}</span>
      <div className={styles.stats}>
        <span className={styles.xp}>{Math.round(xp.total)} XP</span>
        {xp.prs.length > 0 && (
          <span className={styles.prBadge}>
            {xp.prs.length} PR{xp.prs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </Card>
  );
}
