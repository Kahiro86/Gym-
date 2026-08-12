import styles from "./RankBadge.module.css";
import type { RankOrUnranked } from "../../domain/types.js";

export interface RankBadgeProps {
  rank: RankOrUnranked;
}

// F through S, per domain/progression.ts's rankForMuscleXp thresholds — a
// muscle with 0 lifetime XP is "unranked" rather than F, since it's never
// been trained at all, not merely trained little.
export function RankBadge({ rank }: RankBadgeProps) {
  const classes = [styles.badge, styles[rank]].filter(Boolean).join(" ");
  return <span className={classes}>{rank === "unranked" ? "—" : rank}</span>;
}
