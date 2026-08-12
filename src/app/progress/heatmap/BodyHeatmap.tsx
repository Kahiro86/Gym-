import { useMemo, useState } from "react";
import { getMuscle } from "../../../domain/muscles.js";
import { useMuscleHeatmap } from "../../hooks/useMuscleHeatmap.js";
import { formatRelativeDay } from "../../formatRelativeDay.js";
import { BodySilhouette } from "./BodySilhouette.js";
import styles from "./BodyHeatmap.module.css";
import type { MuscleId } from "../../../domain/muscles.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// The Progress tab's body diagram: front and back shown side by side (not
// tabbed — this is the "at a glance" view), each shaded by muscle heat
// (useMuscleHeatmap -> Layer 2's heatmapRepository), with a legend and a
// detail line for whichever muscle was last tapped. Layer 3 never
// computes heat/freshness itself — it only reads the already-derived
// RecencyMapEntry[] and formats it.
export function BodyHeatmap() {
  const { entries } = useMuscleHeatmap();
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
      <div className={styles.card}>
        <div className={styles.bodies}>
          <div className={styles.bodyColumn}>
            <span className={styles.viewLabel}>Front</span>
            <BodySilhouette view="front" heatByMuscle={heatByMuscle} everTrained={everTrained} selectedMuscleId={selectedMuscleId} onSelect={setSelectedMuscleId} />
          </div>
          <div className={styles.bodyColumn}>
            <span className={styles.viewLabel}>Back</span>
            <BodySilhouette view="back" heatByMuscle={heatByMuscle} everTrained={everTrained} selectedMuscleId={selectedMuscleId} onSelect={setSelectedMuscleId} />
          </div>
        </div>

        <div className={styles.legend} aria-hidden="true">
          <span className={styles.legendLabel}>Stale</span>
          <span className={styles.legendBar} />
          <span className={styles.legendLabel}>Fresh</span>
        </div>
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
