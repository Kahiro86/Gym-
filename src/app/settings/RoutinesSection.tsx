import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRoutines } from "../hooks/useRoutines.js";
import { NewRoutineSheet } from "../routines/NewRoutineSheet.js";
import { RoutineRow } from "../routines/RoutineRow.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { useToast } from "../ui/ToastContext.js";
import styles from "./RoutinesSection.module.css";
import type { RoutineRecord } from "../../storage/types.js";

// Create/rename/delete routines, and a way into each one's own exercise
// list (spec §14 task 16) — the routines editor half of this task. Picking
// a routine to *start a session from* stays owned by the Start sheet
// (Task 5); this is the management surface, not the picker.
export function RoutinesSection() {
  const navigate = useNavigate();
  const routines = useRoutines();
  const { showToast, reportError } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);

  async function handleCreate(name: string) {
    const routine = await routines.create({ name });
    setSheetOpen(false);
    navigate(`/routines/${routine.id}`);
  }

  async function handleDelete(routine: RoutineRecord) {
    try {
      await routines.remove(routine.id);
      showToast({
        message: "Routine deleted",
        action: {
          label: "Undo",
          // routineRepository has no "restore" operation — Undo re-creates
          // an equivalent routine (same name/note) rather than literally
          // reviving the old one, same simplification the app already
          // makes for sets and session exercises. Its exercise list is
          // not restored.
          onAction: async () => {
            await routines.create({ name: routine.name, note: routine.note });
          },
        },
      });
    } catch (err) {
      reportError(err, "Failed to delete routine");
    }
  }

  return (
    <section>
      <h2 className={styles.heading}>Routines</h2>

      {!routines.loading && routines.routines.length === 0 && (
        <EmptyState title="No routines yet" description="Create one to reuse it from the Start sheet." />
      )}

      <ul className={styles.list}>
        {routines.routines.map((routine) => (
          <li key={routine.id}>
            <RoutineRow routine={routine} onOpen={() => navigate(`/routines/${routine.id}`)} onDelete={() => handleDelete(routine)} />
          </li>
        ))}
      </ul>

      <Button variant="secondary" className={styles.addButton} onClick={() => setSheetOpen(true)}>
        New routine
      </Button>

      <NewRoutineSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onCreate={handleCreate} />
    </section>
  );
}
