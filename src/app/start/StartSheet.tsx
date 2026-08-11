import { useCallback } from "react";
import { useSession } from "../hooks/useSession.js";
import { useRoutines } from "../hooks/useRoutines.js";
import { Sheet } from "../ui/Sheet.js";
import { ListRow } from "../ui/ListRow.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
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

  const startFree = useCallback(async () => {
    try {
      await session.start(Date.now());
      onStarted();
    } catch (err) {
      // Task 18 owns real error-surfacing UI — for now, just don't leave
      // this unhandled.
      console.error("Failed to start a session", err);
    }
  }, [session, onStarted]);

  const startFromRoutine = useCallback(
    async (routineId: string) => {
      try {
        await session.start(Date.now(), { routineId });
        onStarted();
      } catch (err) {
        console.error("Failed to start a session from routine", err);
      }
    },
    [session, onStarted]
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
