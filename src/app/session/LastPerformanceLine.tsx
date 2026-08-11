import { useLastPerformance } from "../hooks/useLastPerformance.js";
import { formatSetSummary } from "./formatSet.js";
import styles from "./LastPerformanceLine.module.css";

export interface LastPerformanceLineProps {
  exerciseId: string;
  beforeSessionId?: string;
}

export function LastPerformanceLine({ exerciseId, beforeSessionId }: LastPerformanceLineProps) {
  const { lastPerformance, loading } = useLastPerformance(exerciseId, beforeSessionId);

  if (loading) return null;
  if (!lastPerformance) {
    return <p className={styles.line}>First time logging this exercise</p>;
  }

  const summary = lastPerformance.sets.map(formatSetSummary).join(", ");
  return (
    <p className={styles.line}>
      Last time: <span className={styles.value}>{summary}</span>
    </p>
  );
}
