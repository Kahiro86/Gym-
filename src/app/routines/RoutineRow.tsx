import styles from "./RoutineRow.module.css";
import type { RoutineRecord } from "../../storage/types.js";

export interface RoutineRowProps {
  routine: RoutineRecord;
  onOpen(): void;
  onDelete(): void;
}

// Not built on ListRow: that component renders as a single <button> when
// interactive, and this row needs two independent tap targets (open the
// routine, delete it) — nesting a delete <button> inside ListRow's own
// row button would be invalid HTML, same reasoning ExerciseCard's
// Swap/Skip header already worked around by not using ListRow either.
export function RoutineRow({ routine, onOpen, onDelete }: RoutineRowProps) {
  return (
    <div className={styles.row}>
      <button type="button" className={styles.name} onClick={onOpen}>
        {routine.name}
      </button>
      <button type="button" className={styles.deleteButton} aria-label={`Delete ${routine.name}`} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}
