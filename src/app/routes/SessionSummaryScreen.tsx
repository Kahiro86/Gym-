import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { getMuscle } from "../../domain/muscles.js";
import { PrRow } from "../session/PrRow.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import styles from "./SessionSummaryScreen.module.css";
import type { SessionSummaryState } from "../session/sessionSummary.js";
import type { MuscleId } from "../../domain/muscles.js";

const TOP_MUSCLE_COUNT = 5;

// The authoritative close to a session (spec §14 task 12): final XP total,
// any PRs, muscles trained, and — when the session's XP crossed a level
// threshold — a level-up moment. Reads its data from router navigation
// state rather than a hook of its own: ActiveSessionScreen's finish
// handler computes it once, right as the session ends, and this screen
// only ever exists as that hand-off's destination. Landing here with no
// state (a refresh, a direct link) means there's nothing to show, so it
// redirects home instead of rendering broken.
export function SessionSummaryScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as SessionSummaryState | null;

  if (!state) return <Navigate to="/today" replace />;

  const { xp, levelBefore, levelAfter } = state;
  const leveledUp = levelAfter.level > levelBefore.level;

  const topMuscles = (Object.entries(xp.muscleXp) as [MuscleId, number][])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MUSCLE_COUNT);

  return (
    <div className={styles.screen}>
      <h1>Workout complete</h1>

      {leveledUp && (
        <Card className={styles.levelUp}>
          <span className={styles.levelUpLabel}>Level up!</span>
          <span className={styles.levelUpValue}>
            Lv {levelBefore.level} → Lv {levelAfter.level}
          </span>
        </Card>
      )}

      <Card className={styles.totalCard}>
        <span className={styles.totalValue}>{Math.round(xp.total)} XP</span>
        <span className={styles.totalLabel}>earned this session</span>
      </Card>

      {xp.prs.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading}>Personal records</h2>
          <ul className={styles.list}>
            {xp.prs.map((pr, index) => (
              <li key={index}>
                <PrRow pr={pr} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {topMuscles.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading}>Muscles trained</h2>
          <ul className={styles.list}>
            {topMuscles.map(([muscleId, amount]) => (
              <li key={muscleId} className={styles.muscleRow}>
                <span>{getMuscle(muscleId).displayName}</span>
                <span>{Math.round(amount)} XP</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button className={styles.doneButton} onClick={() => navigate("/today")}>
        Done
      </Button>
    </div>
  );
}
