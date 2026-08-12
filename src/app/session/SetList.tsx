import { useToast } from "../ui/ToastContext.js";
import { ListRow } from "../ui/ListRow.js";
import { formatSetSummary } from "./formatSet.js";
import styles from "./SetList.module.css";
import type { NewSet } from "../../storage/repositories/setRepository.js";
import type { SetRecord } from "../../storage/types.js";

export interface SetListProps {
  sets: SetRecord[];
  // Passed down from the same useSets() instance LogSetForm writes
  // through, rather than calling useSets() again here — see the note on
  // LogSetForm's `log` prop for why.
  remove(id: string): Promise<void>;
  log(input: NewSet): Promise<SetRecord>;
  // Fires after a delete or an undo-restore — the session's live XP
  // total (Task 11) has its own separate hook instance that has no way
  // to know this list changed otherwise.
  onChange?(): void;
}

// The already-logged sets for one sessionExercise (spec §14 task 7).
// Deleting is undo-toast, not a confirm dialog (§2) — since
// setRepository has no "restore a soft-deleted row" operation, Undo
// re-logs an equivalent new set rather than literally reviving the old
// one; from the user's perspective the effect is identical.
export function SetList({ sets, remove, log, onChange }: SetListProps) {
  const { showToast, reportError } = useToast();

  if (sets.length === 0) return null;

  async function handleDelete(set: SetRecord) {
    try {
      await remove(set.id);
    } catch (err) {
      reportError(err, "Failed to delete set");
      return;
    }
    onChange?.();
    showToast({
      message: "Set deleted",
      action: {
        label: "Undo",
        onAction: async () => {
          await log({
            sessionExerciseId: set.sessionExerciseId,
            weightKg: set.weightKg,
            reps: set.reps,
            durationSec: set.durationSec,
            distanceM: set.distanceM,
            isWarmup: set.isWarmup,
            completed: set.completed,
            targetReps: set.targetReps,
            note: set.note,
            bodyweightKgAtTime: set.bodyweightKgAtTime,
            loggedAt: set.loggedAt,
          });
          onChange?.();
        },
      },
    });
  }

  return (
    <ul className={styles.list}>
      {sets.map((set, index) => (
        <li key={set.id}>
          <ListRow
            leading={<span className={styles.index}>{index + 1}</span>}
            label={formatSetSummary(set)}
            description={set.isWarmup ? "Warmup" : undefined}
            trailing={
              <button type="button" className={styles.deleteButton} aria-label={`Delete set ${index + 1}`} onClick={() => handleDelete(set)}>
                ×
              </button>
            }
          />
        </li>
      ))}
    </ul>
  );
}
