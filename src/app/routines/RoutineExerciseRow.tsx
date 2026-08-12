import { useExercise } from "../hooks/useExercise.js";
import { Stepper } from "../ui/Stepper.js";
import styles from "./RoutineExerciseRow.module.css";
import type { NewRoutineExercise } from "../../storage/repositories/routineRepository.js";
import type { RoutineExerciseRecord } from "../../storage/types.js";

export interface RoutineExerciseRowProps {
  routineExercise: RoutineExerciseRecord;
  onChangeTargets(patch: Partial<NewRoutineExercise>): void;
  onRemove(): void;
}

const DEFAULT_TARGET_SETS = 3;
const DEFAULT_TARGET_REPS = 8;

// One exercise within a routine's editor (spec §14 task 16) — target sets
// and reps only (no target weight editor here: it's a much less stable
// number across weeks than sets/reps, and the plan-vs-performed comparison
// storage already supports it being null). No reorder — see
// RoutineDetailScreen's note on that scope cut.
export function RoutineExerciseRow({ routineExercise, onChangeTargets, onRemove }: RoutineExerciseRowProps) {
  const { exercise } = useExercise(routineExercise.exerciseId);

  return (
    <div className={styles.row}>
      <div className={styles.header}>
        <span className={styles.name}>{exercise?.name ?? "…"}</span>
        <button type="button" className={styles.removeButton} aria-label={`Remove ${exercise?.name ?? "exercise"}`} onClick={onRemove}>
          ×
        </button>
      </div>
      <div className={styles.targets}>
        <Stepper
          label="Target sets"
          value={routineExercise.targetSets ?? DEFAULT_TARGET_SETS}
          min={1}
          max={10}
          onChange={(next) => onChangeTargets({ targetSets: next })}
        />
        <Stepper
          label="Target reps"
          value={routineExercise.targetReps ?? DEFAULT_TARGET_REPS}
          min={1}
          max={50}
          onChange={(next) => onChangeTargets({ targetReps: next })}
        />
      </div>
    </div>
  );
}
