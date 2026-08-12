import { useCallback } from "react";
import { useSession } from "../hooks/useSession.js";
import { useRoutines } from "../hooks/useRoutines.js";
import { Sheet } from "../ui/Sheet.js";
import { ListRow } from "../ui/ListRow.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { useToast } from "../ui/ToastContext.js";
import styles from "./StartSheet.module.css";

export interface StartSheetProps {
  open: boolean;
  onClose(): void;
  onStarted(): void;
}

// Picking a routine here only creates the session tagged with routineId —
// pre-filling its exercises from the routine's own exercise list is the
// logging screen's job (Tasks 6-7/10), not this sheet's.
export function StartSheet({ open, onClose, onStarted }: StartSheetProps) {
  const session = useSession();
  const routines = useRoutines();
  const { reportError } = useToast();

  const startFree = useCallback(async () => {
    try {
      await session.start(Date.now());
      onStarted();
    } catch (err) {
      reportError(err, "Failed to start a session");
    }
  }, [session, onStarted, reportError]);

  const startFromRoutine = useCallback(
    async (routineId: string) => {
      try {
        await session.start(Date.now(), { routineId });
        onStarted();
      } catch (err) {
        reportError(err, "Failed to start a session");
      }
    },
    [session, onStarted, reportError]
  );

  return (
    <Sheet open={open} onClose={onClose} title="Start a workout">
      <div className={styles.content}>
        <Button className={styles.freeButton} onClick={startFree}>
          Free Workout
        </Button>

        <h3 className={styles.sectionTitle}>Your routines</h3>
        {routines.loading ? null : routines.routines.length === 0 ? (
          <EmptyState title="No routines yet" description="Save a routine to start it here next time." />
        ) : (
          <ul className={styles.list}>
            {routines.routines.map((routine) => (
              <li key={routine.id}>
                <ListRow label={routine.name} onClick={() => startFromRoutine(routine.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
