import { useMemo, useState } from "react";
import { GROUPS, musclesInGroup } from "../../../domain/muscles.js";
import { useMuscleHeatmap } from "../../hooks/useMuscleHeatmap.js";
import { formatRelativeDay } from "../../formatRelativeDay.js";
import { RadarChart } from "./RadarChart.js";
import styles from "./BodyHeatmap.module.css";
import type { RadarAxis } from "./RadarChart.js";
import type { GroupId } from "../../../domain/muscles.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface GroupHeat {
  groupId: GroupId;
  label: string;
  heat: number;
  trained: boolean;
  daysSinceTrained: number | null; // most recent across the group's muscles
}

// The Progress tab's body diagram: a hexagonal radar chart, one axis per
// body-region group (GROUPS: chest, back, shoulders, arms, core, legs),
// each axis's value the average current heat of that group's muscles
// (useMuscleHeatmap -> Layer 2's heatmapRepository). A legend and a
// detail line show whichever group was last tapped. Layer 3 never
// computes heat itself — it only aggregates the already-derived
// per-muscle RecencyMapEntry[] up to group level and formats it.
export function BodyHeatmap() {
  const { entries } = useMuscleHeatmap();
  const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(null);

  const groupHeats = useMemo<GroupHeat[] | null>(() => {
    if (!entries) return null;
    return GROUPS.map((group) => {
      const muscles = musclesInGroup(group.id);
      const rows = muscles.map((m) => entries.find((e) => e.muscleId === m.id));
      const heats = rows.map((r) => r?.heat ?? 0);
      const trainedDays = rows.map((r) => r?.daysSinceTrained).filter((d): d is number => d !== null && d !== undefined);
      return {
        groupId: group.id,
        label: group.displayName,
        heat: heats.reduce((sum, h) => sum + h, 0) / heats.length,
        trained: trainedDays.length > 0,
        daysSinceTrained: trainedDays.length > 0 ? Math.min(...trainedDays) : null,
      };
    });
  }, [entries]);

  if (!groupHeats) return null;

  const axes: RadarAxis[] = groupHeats.map((g) => ({ id: g.groupId, label: g.label, value: g.heat, trained: g.trained }));
  const selected = groupHeats.find((g) => g.groupId === selectedGroupId) ?? null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <RadarChart axes={axes} selectedId={selectedGroupId} onSelect={(id) => setSelectedGroupId(id as GroupId)} />

        <div className={styles.legend} aria-hidden="true">
          <span className={styles.legendLabel}>Stale</span>
          <span className={styles.legendBar} />
          <span className={styles.legendLabel}>Fresh</span>
        </div>
      </div>

      <div className={styles.detail} role="status">
        {selected ? (
          <>
            <span className={styles.detailName}>{selected.label}</span>
            <span className={styles.detailMeta}>
              {selected.daysSinceTrained === null
                ? "Not trained yet"
                : `${Math.round(selected.heat * 100)}% fresh · ${formatRelativeDay(Date.now() - selected.daysSinceTrained * DAY_MS)}`}
            </span>
          </>
        ) : (
          <span className={styles.detailMeta}>Tap a point to see when that group was last trained.</span>
        )}
      </div>
    </div>
  );
}
