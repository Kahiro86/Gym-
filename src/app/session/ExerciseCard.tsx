import { useExercise } from "../hooks/useExercise.js";
import { useSets } from "../hooks/useSets.js";
import { LastPerformanceLine } from "./LastPerformanceLine.js";
import { SetList } from "./SetList.js";
import { LogSetForm } from "./LogSetForm.js";
import { Card } from "../ui/Card.js";
import styles from "./ExerciseCard.module.css";

export interface ExerciseCardProps {
  sessionExerciseId: string;
  exerciseId: string;
  sessionId: string;
}

// One exercise slot within the logging screen (spec §14 task 7): name,
// what was done last time, the sets logged so far this session, and the
// input form for the next one. useSets() is called once here and passed
// down to both SetList and LogSetForm — two separate hook instances for
// the same sessionExerciseId wouldn't see each other's writes, so a
// logged set would never show up in the list next to the form that
// logged it.
export function ExerciseCard({ sessionExerciseId, exerciseId, sessionId }: ExerciseCardProps) {
  const { exercise, loading } = useExercise(exerciseId);
  const { sets, log, remove } = useSets(sessionExerciseId);
  if (loading || !exercise) return null;

  return (
    <Card className={styles.card}>
      <h2 className={styles.name}>{exercise.name}</h2>
      <LastPerformanceLine exerciseId={exerciseId} beforeSessionId={sessionId} />
      <SetList sets={sets} remove={remove} log={log} />
      <LogSetForm sessionExerciseId={sessionExerciseId} exerciseId={exerciseId} log={log} />
    </Card>
  );
}
