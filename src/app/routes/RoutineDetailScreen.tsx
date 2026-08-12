import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useRoutines } from "../hooks/useRoutines.js";
import { useRoutineExercises } from "../hooks/useRoutineExercises.js";
import { ExerciseSearchSheet } from "../session/ExerciseSearchSheet.js";
import { RoutineExerciseRow } from "../routines/RoutineExerciseRow.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { useToast } from "../ui/ToastContext.js";
import styles from "./RoutineDetailScreen.module.css";
import type { RoutineExerciseRecord } from "../../storage/types.js";

// Editing one routine's exercise list (spec §14 task 16) — add/remove
// exercises and their target sets/reps. No drag-to-reorder: routineExerciseRepository
// already supports it (same sparse-index scheme as sessionExercise's own
// reorder), but building the drag UI itself is a scope cut for this task —
// exercises append in the order they're added, same as a session's own
// exercise list already works before any reordering exists there either.
export function RoutineDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const routines = useRoutines();
  const routineExercises = useRoutineExercises(id ?? null);
  const { showToast, reportError } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (routines.loading) return null;

  const routine = routines.routines.find((r) => r.id === id);
  if (!routine) return <Navigate to="/more" replace />;

  async function handleAdd(exerciseId: string) {
    setSheetOpen(false);
    try {
      await routineExercises.add({ routineId: routine!.id, exerciseId });
    } catch (err) {
      reportError(err, "Failed to add exercise to routine");
    }
  }

  async function handleRemove(re: RoutineExerciseRecord) {
    try {
      await routineExercises.remove(re.id);
      showToast({
        message: "Exercise removed",
        action: {
          label: "Undo",
          onAction: async () => {
            await routineExercises.add({
              routineId: re.routineId,
              exerciseId: re.exerciseId,
              supersetGroup: re.supersetGroup,
              targetSets: re.targetSets,
              targetReps: re.targetReps,
              targetWeightKg: re.targetWeightKg,
              note: re.note,
            });
          },
        },
      });
    } catch (err) {
      reportError(err, "Failed to remove exercise from routine");
    }
  }

  return (
    <div className={styles.screen}>
      <Button variant="ghost" size="compact" className={styles.backButton} onClick={() => navigate("/more")}>
        ← Back
      </Button>
      <h1>{routine.name}</h1>

      {!routineExercises.loading && routineExercises.routineExercises.length === 0 && (
        <EmptyState title="No exercises yet" description="Add exercises to build this routine out." />
      )}

      <ul className={styles.list}>
        {routineExercises.routineExercises.map((re) => (
          <li key={re.id}>
            <RoutineExerciseRow
              routineExercise={re}
              onChangeTargets={(patch) => routineExercises.update(re.id, patch)}
              onRemove={() => handleRemove(re)}
            />
          </li>
        ))}
      </ul>

      <Button variant="secondary" onClick={() => setSheetOpen(true)}>
        Add exercise
      </Button>

      <ExerciseSearchSheet open={sheetOpen} title="Add exercise" onClose={() => setSheetOpen(false)} onPick={handleAdd} />
    </div>
  );
}
