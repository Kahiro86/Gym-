import { Card } from "../ui/Card.js";
import styles from "./LevelCard.module.css";
import type { LevelProgress } from "../../domain/progression.js";

export interface LevelCardProps {
  level: LevelProgress;
}

// The player's overall level and progress toward the next one (Today tab,
// spec §14 task 13) — a thin presentational read of Layer 1's
// levelFromTotalXp() curve, fed by useLifetimeLevel.
export function LevelCard({ level }: LevelCardProps) {
  const progress = level.xpForNext > 0 ? Math.min(1, level.xpIntoLevel / level.xpForNext) : 0;

  return (
    <Card className={styles.card}>
      <div className={styles.headline}>
        <span className={styles.level}>Level {level.level}</span>
        <span className={styles.xp}>
          {Math.round(level.xpIntoLevel)} / {Math.round(level.xpForNext)} XP
        </span>
      </div>
      <div className={styles.track} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={styles.fill} style={{ width: `${progress * 100}%` }} />
      </div>
    </Card>
  );
}
