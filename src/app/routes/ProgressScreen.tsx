import { useState } from "react";
import { GROUPS } from "../../domain/muscles.js";
import { useLifetimeLevel } from "../hooks/useLifetimeLevel.js";
import { useMuscleXp } from "../hooks/useMuscleXp.js";
import { LevelCard } from "../home/LevelCard.js";
import { MuscleGroupSection } from "../progress/MuscleGroupSection.js";
import { BodyHeatmap } from "../progress/heatmap/BodyHeatmap.js";
import { Button } from "../ui/Button.js";
import styles from "./ProgressScreen.module.css";

type ProgressTab = "heatmap" | "byMuscle";

// The long-term progression view (spec §14 task 15, extended with a
// heatmap follow-up): overall level, then either the body heatmap (which
// muscle heat/freshness) or the per-muscle XP/rank breakdown, grouped by
// body region. Reuses LevelCard from the Today tab (Task 13) rather than
// a second copy — it's the same "what level am I" reading either place.
// Defaults to the heatmap: it's the at-a-glance "what did I train
// recently" view, with the XP breakdown a tap away for anyone who wants
// the numbers.
export function ProgressScreen() {
  const { level } = useLifetimeLevel();
  const { muscleXp } = useMuscleXp();
  const [tab, setTab] = useState<ProgressTab>("heatmap");

  return (
    <div className={styles.screen}>
      <h1>Progress</h1>
      {level && <LevelCard level={level} />}

      <div className={styles.tabToggle} role="tablist" aria-label="Progress view">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "heatmap"}
          variant={tab === "heatmap" ? "secondary" : "ghost"}
          className={styles.tabButton}
          onClick={() => setTab("heatmap")}
        >
          Heatmap
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "byMuscle"}
          variant={tab === "byMuscle" ? "secondary" : "ghost"}
          className={styles.tabButton}
          onClick={() => setTab("byMuscle")}
        >
          By muscle
        </Button>
      </div>

      {tab === "heatmap" && <BodyHeatmap />}
      {tab === "byMuscle" && muscleXp && GROUPS.map((group) => <MuscleGroupSection key={group.id} group={group} muscleXp={muscleXp} />)}
    </div>
  );
}
