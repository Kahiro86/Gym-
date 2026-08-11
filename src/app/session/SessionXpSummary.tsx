import { getMuscle } from "../../domain/muscles.js";
import styles from "./SessionXpSummary.module.css";
import type { SessionXpResult } from "../../domain/types.js";
import type { MuscleId } from "../../domain/muscles.js";

export interface SessionXpSummaryProps {
  xp: SessionXpResult | null;
}

const TOP_MUSCLE_COUNT = 3;

// The live XP breakdown for the in-progress session (spec §14 task 11):
// running total, any PRs hit so far, and the top few muscles trained by
// XP. A best-effort preview, not the authoritative number — Task 12's
// session summary is what finalizes and displays the confirmed total
// once the workout ends. Purely presentational: the owning screen holds
// the one useSessionXp() instance (see ExerciseCard's note on why) and
// passes its result straight through.
export function SessionXpSummary({ xp }: SessionXpSummaryProps) {
  if (!xp || xp.total === 0) return null;

  const topMuscles = (Object.entries(xp.muscleXp) as [MuscleId, number][])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MUSCLE_COUNT);

  return (
    <div className={styles.summary}>
      <div className={styles.headline}>
        <span className={styles.total}>{Math.round(xp.total)} XP</span>
        {xp.prs.length > 0 && (
          <span className={styles.prBadge}>
            {xp.prs.length} PR{xp.prs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {topMuscles.length > 0 && (
        <ul className={styles.muscles}>
          {topMuscles.map(([muscleId, amount]) => (
            <li key={muscleId}>
              {getMuscle(muscleId).displayName}: {Math.round(amount)} XP
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
