import { GROUPS } from "../../domain/muscles.js";
import { useLifetimeLevel } from "../hooks/useLifetimeLevel.js";
import { useMuscleXp } from "../hooks/useMuscleXp.js";
import { LevelCard } from "../home/LevelCard.js";
import { MuscleGroupSection } from "../progress/MuscleGroupSection.js";
import styles from "./ProgressScreen.module.css";

// The long-term progression view (spec §14 task 15): overall level, then
// every muscle's own lifetime XP and rank, grouped by body region. Reuses
// LevelCard from the Today tab (Task 13) rather than a second copy — it's
// the same "what level am I" reading either place.
export function ProgressScreen() {
  const { level } = useLifetimeLevel();
  const { muscleXp } = useMuscleXp();

  return (
    <div className={styles.screen}>
      <h1>Progress</h1>
      {level && <LevelCard level={level} />}
      {muscleXp && GROUPS.map((group) => <MuscleGroupSection key={group.id} group={group} muscleXp={muscleXp} />)}
    </div>
  );
}
