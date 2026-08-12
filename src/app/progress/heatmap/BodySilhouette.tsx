import { getMuscle } from "../../../domain/muscles.js";
import { heatColor } from "./heatColor.js";
import { BASE_SHAPES, BACK_REGIONS, FRONT_REGIONS, SEAMS, VIEWBOX_HEIGHT, VIEWBOX_WIDTH } from "./bodyRegions.js";
import styles from "./BodySilhouette.module.css";
import type { RegionShape } from "./bodyRegions.js";
import type { MuscleId } from "../../../domain/muscles.js";

export interface BodySilhouetteProps {
  view: "front" | "back";
  // muscleId -> heat (0-1); a muscle with no entry (or heat undefined) is
  // treated as never-trained, same as a RecencyMapEntry with heat 0 and
  // daysSinceTrained null.
  heatByMuscle: Partial<Record<MuscleId, number>>;
  everTrained: Partial<Record<MuscleId, boolean>>;
  selectedMuscleId: MuscleId | null;
  onSelect(muscleId: MuscleId): void;
}

function pointsAttr(shape: RegionShape): string {
  return shape.points.map(([x, y]) => `${x},${y}`).join(" ");
}

// The Progress tab's body diagram — a faceted, tappable front/back
// silhouette shaded by each muscle's recency-weighted heat (Layer 2's
// heatmapRepository, itself a thin wire of the pre-existing pure math in
// src/heatmap/ onto real storage). Layer 3 never computes heat itself:
// heatByMuscle/everTrained are handed down already-derived from
// useMuscleHeatmap.
export function BodySilhouette({ view, heatByMuscle, everTrained, selectedMuscleId, onSelect }: BodySilhouetteProps) {
  const regions = view === "front" ? FRONT_REGIONS : BACK_REGIONS;
  const seams = SEAMS.filter((s) => s.view === view || s.view === "both");

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      role="group"
      aria-label={`${view === "front" ? "Front" : "Back"} body heatmap`}
    >
      {BASE_SHAPES.map((shape, i) => (
        <polygon key={`base-${i}`} points={pointsAttr(shape)} className={styles.base} />
      ))}
      {regions.map((region) => {
        const muscle = getMuscle(region.muscleId);
        const heat = heatByMuscle[region.muscleId] ?? 0;
        const trained = everTrained[region.muscleId] ?? false;
        const selected = selectedMuscleId === region.muscleId;
        const fill = heatColor(heat);
        return (
          <g
            key={region.muscleId}
            role="button"
            tabIndex={0}
            aria-label={`${muscle.displayName}: ${trained ? `${Math.round(heat * 100)}% fresh` : "not trained yet"}`}
            aria-pressed={selected}
            className={[styles.region, selected ? styles.selected : ""].filter(Boolean).join(" ")}
            onClick={() => onSelect(region.muscleId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(region.muscleId);
              }
            }}
          >
            {region.shapes.map((shape, i) => (
              <polygon key={`${region.muscleId}-${i}`} points={pointsAttr(shape)} fill={fill} className={styles.facet} />
            ))}
          </g>
        );
      })}
      {seams.map((seam, i) => (
        <polyline key={`seam-${i}`} points={seam.points.map(([x, y]) => `${x},${y}`).join(" ")} className={styles.seam} />
      ))}
    </svg>
  );
}
