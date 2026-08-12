import { useMemo, useState } from "react";
import { getMuscle } from "../../../domain/muscles.js";
import { useMuscleHeatmap } from "../../hooks/useMuscleHeatmap.js";
import { formatRelativeDay } from "../../formatRelativeDay.js";
import { Button } from "../../ui/Button.js";
import { BodySilhouette } from "./BodySilhouette.js";
import styles from "./BodyHeatmap.module.css";
import type { MuscleId } from "../../../domain/muscles.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type BodyView = "front" | "back";

// The Progress tab's body diagram: a tappable front/back silhouette
// shaded by each muscle's current heat (useMuscleHeatmap -> Layer 2's
// heatmapRepository), with a legend and a detail line for whichever
// muscle was last tapped. Layer 3 never computes heat/freshness itself —
// it only reads the already-derived RecencyMapEntry[] and formats it.
export function BodyHeatmap() {
  const { entries } = useMuscleHeatmap();
  const [view, setView] = useState<BodyView>("front");
  const [selectedMuscleId, setSelectedMuscleId] = useState<MuscleId | null>(null);

  const heatByMuscle = useMemo(() => {
    const map: Partial<Record<MuscleId, number>> = {};
    for (const entry of entries ?? []) map[entry.muscleId] = entry.heat;
    return map;
  }, [entries]);

  const everTrained = useMemo(() => {
    const map: Partial<Record<MuscleId, boolean>> = {};
    for (const entry of entries ?? []) map[entry.muscleId] = entry.daysSinceTrained !== null;
    return map;
  }, [entries]);

  if (!entries) return null;

  const selectedEntry = entries.find((e) => e.muscleId === selectedMuscleId) ?? null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.viewToggle} role="tablist" aria-label="Body view">
        <Button
          type="button"
          role="tab"
          aria-selected={view === "front"}
          variant={view === "front" ? "secondary" : "ghost"}
          className={styles.viewButton}
          onClick={() => setView("front")}
        >
          Front
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={view === "back"}
          variant={view === "back" ? "secondary" : "ghost"}
          className={styles.viewButton}
          onClick={() => setView("back")}
        >
          Back
        </Button>
      </div>

      <BodySilhouette view={view} heatByMuscle={heatByMuscle} everTrained={everTrained} selectedMuscleId={selectedMuscleId} onSelect={setSelectedMuscleId} />

      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendLabel}>Stale</span>
        <span className={styles.legendBar} />
        <span className={styles.legendLabel}>Fresh</span>
      </div>

      <div className={styles.detail} role="status">
        {selectedEntry ? (
          <>
            <span className={styles.detailName}>{getMuscle(selectedEntry.muscleId).displayName}</span>
            <span className={styles.detailMeta}>
              {selectedEntry.daysSinceTrained === null
                ? "Not trained yet"
                : `${Math.round(selectedEntry.heat * 100)}% fresh · ${formatRelativeDay(Date.now() - selectedEntry.daysSinceTrained * DAY_MS)}`}
            </span>
          </>
        ) : (
          <span className={styles.detailMeta}>Tap a muscle to see when it was last trained.</span>
        )}
      </div>
    </div>
  );
}
