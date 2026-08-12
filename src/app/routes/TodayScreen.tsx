import { useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSession.js";
import { useLifetimeLevel } from "../hooks/useLifetimeLevel.js";
import { useCurrentStreak } from "../hooks/useCurrentStreak.js";
import { useLastCompletedSession } from "../hooks/useLastCompletedSession.js";
import { LevelCard } from "../home/LevelCard.js";
import { StreakCard } from "../home/StreakCard.js";
import { LastWorkoutCard } from "../home/LastWorkoutCard.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import styles from "./TodayScreen.module.css";

// The home tab (spec §14 task 13): overall level/XP progress, the current
// weekly streak, a recap of the last workout, and a way back into an
// in-progress session. Starting a *new* workout stays owned entirely by
// the Start tab (Task 5) — this only ever links there, never duplicates
// StartSheet's own flow.
export function TodayScreen() {
  const navigate = useNavigate();
  const session = useSession();
  const { level } = useLifetimeLevel();
  const { streakWeeks } = useCurrentStreak();
  const { lastSession, loading: lastSessionLoading } = useLastCompletedSession();

  const active = session.check;

  return (
    <div className={styles.screen}>
      <h1>Today</h1>

      {active && !active.isStale && (
        <Card className={styles.resumeCard}>
          <p className={styles.resumeLabel}>Session in progress</p>
          <Button onClick={() => navigate("/session")}>Continue workout</Button>
        </Card>
      )}

      {active && active.isStale && (
        <Card className={styles.resumeCard}>
          <p className={styles.resumeLabel}>You left a session running</p>
          {/* Resuming a stale session has to go through
              sessionRepository.resume() first — StartScreen already owns
              that decision (and the alternative, discarding it), so this
              only ever hands off to it rather than re-implementing either. */}
          <Button onClick={() => navigate("/start")}>Resume</Button>
        </Card>
      )}

      {level && <LevelCard level={level} />}
      {streakWeeks !== null && <StreakCard streakWeeks={streakWeeks} />}
      {!lastSessionLoading && <LastWorkoutCard lastSession={lastSession} />}

      {!active && (
        <Button variant="secondary" className={styles.startButton} onClick={() => navigate("/start")}>
          Start a workout
        </Button>
      )}
    </div>
  );
}
