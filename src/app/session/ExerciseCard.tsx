import { useExercise } from "../hooks/useExercise.js";
import { useSets } from "../hooks/useSets.js";
import { LastPerformanceLine } from "./LastPerformanceLine.js";
import { SetList } from "./SetList.js";
import { LogSetForm } from "./LogSetForm.js";
import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import styles from "./ExerciseCard.module.css";

export interface ExerciseCardProps {
  sessionExerciseId: string;
  exerciseId: string;
  sessionId: string;
  // Opens the search sheet in swap mode for this slot (Task 10) — the
  // sheet itself, and what "picking" an exercise means while it's open,
  // live in the parent (ActiveSessionScreen) since only one can be open
  // at a time across every card.
  onSwap(): void;
  onSkip(): void;
}

// One exercise slot within the logging screen (spec §14 tasks 7 & 10):
// name, swap/skip actions, what was done last time, the sets logged so
// far this session, and the input form for the next one. useSets() is
// called once here and passed down to both SetList and LogSetForm — two
// separate hook instances for the same sessionExerciseId wouldn't see
// each other's writes, so a logged set would never show up in the list
// next to the form that logged it.
export function ExerciseCard({ sessionExerciseId, exerciseId, sessionId, onSwap, onSkip }: ExerciseCardProps) {
  const { exercise, loading } = useExercise(exerciseId);
  const { sets, log, remove } = useSets(sessionExerciseId);
  if (loading || !exercise) return null;

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.name}>{exercise.name}</h2>
        <div className={styles.headerActions}>
          <Button size="compact" variant="secondary" onClick={onSwap}>
            Swap
          </Button>
          <Button size="compact" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        </div>
      </div>
      <LastPerformanceLine exerciseId={exerciseId} beforeSessionId={sessionId} />
      <SetList sets={sets} remove={remove} log={log} />
      <LogSetForm sessionExerciseId={sessionExerciseId} exerciseId={exerciseId} log={log} />
    </Card>
  );
}
