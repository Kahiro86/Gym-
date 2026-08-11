import { useEffect, useState } from "react";
import { useExerciseSearch } from "../hooks/useExerciseSearch.js";
import { Sheet } from "../ui/Sheet.js";
import { ListRow } from "../ui/ListRow.js";
import { EmptyState } from "../ui/EmptyState.js";
import styles from "./ExerciseSearchSheet.module.css";

export interface ExerciseSearchSheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  onPick(exerciseId: string): void;
}

// The shared search UI behind both "add an exercise" and "swap this one
// for a different exercise" (spec §14 task 10) — same useExerciseSearch
// hook as Task 2, presented as a bottom Sheet like the Start sheet
// (Task 5) rather than an inline dropdown. Deliberately dumb: it only
// reports which exercise was picked, the caller decides what that means
// (add vs. substitute) and closes the sheet.
export function ExerciseSearchSheet({ open, title, onClose, onPick }: ExerciseSearchSheetProps) {
  const [query, setQuery] = useState("");
  const { results } = useExerciseSearch(query, 20);

  // The Sheet just renders null while closed rather than unmounting, so
  // this component's own state would otherwise carry a stale query into
  // the next time it's opened (e.g. add, then swap, without a page reload
  // in between).
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <input
        className={styles.input}
        type="text"
        inputMode="search"
        placeholder="Search exercises…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search exercises"
        autoFocus
      />
      {query.trim() === "" ? null : results.length === 0 ? (
        <EmptyState title="No matches" description="Try a different search term." />
      ) : (
        <ul className={styles.results}>
          {results.map((exercise) => (
            <li key={exercise.id}>
              <ListRow label={exercise.name} onClick={() => onPick(exercise.id)} />
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
