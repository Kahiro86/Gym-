import { useState } from "react";
import { useExerciseSearch } from "../hooks/useExerciseSearch.js";
import { ListRow } from "../ui/ListRow.js";
import styles from "./AddExerciseField.module.css";

export interface AddExerciseFieldProps {
  onAdd(exerciseId: string): void;
}

// A minimal add-exercise affordance so the logging screen (Task 7) is
// usable end-to-end before Task 10 builds the full add/swap/skip/search
// sheet — this only ever adds, on top of the same useExerciseSearch hook
// from Task 2.
export function AddExerciseField({ onAdd }: AddExerciseFieldProps) {
  const [query, setQuery] = useState("");
  const { results } = useExerciseSearch(query, 8);

  return (
    <div className={styles.field}>
      <input
        className={styles.input}
        type="text"
        inputMode="search"
        placeholder="Add an exercise…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search exercises"
      />
      {query.trim() !== "" && (
        <ul className={styles.results}>
          {results.map((exercise) => (
            <li key={exercise.id}>
              <ListRow
                label={exercise.name}
                onClick={() => {
                  onAdd(exercise.id);
                  setQuery("");
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
