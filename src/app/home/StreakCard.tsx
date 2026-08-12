import { Card } from "../ui/Card.js";
import styles from "./StreakCard.module.css";

export interface StreakCardProps {
  streakWeeks: number;
}

// Current consecutive-week training streak (Today tab, spec §14 task 13),
// fed by derivedStateRepository.getCurrentStreakWeeks() via useCurrentStreak
// — the same calendar-weeks concept xp.ts's streak multiplier rewards.
export function StreakCard({ streakWeeks }: StreakCardProps) {
  return (
    <Card className={styles.card}>
      {streakWeeks > 0 ? (
        <>
          <span className={styles.value}>{streakWeeks}</span>
          <span className={styles.label}>week{streakWeeks === 1 ? "" : "s"} in a row</span>
        </>
      ) : (
        <span className={styles.label}>Train this week to start a streak</span>
      )}
    </Card>
  );
}
