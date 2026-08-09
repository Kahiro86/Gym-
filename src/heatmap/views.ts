import { MUSCLES, GROUPS, getMuscle } from "../domain/muscles.js";
import { addWeeks, weekStartFor, MS_PER_DAY } from "./store.js";
import type { GroupId, MuscleId } from "../domain/muscles.js";
import type { MuscleContribution } from "../domain/types.js";
import type { MuscleRollupStore, MuscleWeekRollupRow } from "./store.js";

const TRAILING_AVERAGE_WEEKS = 8;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// §6.2: "Group color = volume-weighted mean of child heads (not max)."
function volumeWeightedMean(children: Array<{ value: number; volume: number }>): number {
  const totalVolume = children.reduce((sum, c) => sum + c.volume, 0);
  if (totalVolume <= 0) return 0;
  return children.reduce((sum, c) => sum + c.value * c.volume, 0) / totalVolume;
}

// ---- 6.1 Recency map ----

export interface RecencyMapEntry {
  muscleId: MuscleId;
  heat: number; // 0-1
  freshness: number;
  trailingAverage: number;
  daysSinceTrained: number | null;
}

function decayedRowVolume(row: MuscleWeekRollupRow | undefined, nowMs: number, tauDays: number): number {
  if (!row || row.totalVolume <= 0 || row.lastTrainedAt == null) return 0;
  const deltaDays = Math.max(0, (nowMs - row.lastTrainedAt) / MS_PER_DAY);
  return row.totalVolume * Math.exp(-deltaDays / tauDays);
}

// Only the current (partial) week and the previous week are stored at
// weekly granularity, so freshness is approximated by treating each week's
// total as concentrated at that week's last_trained_at — matching §6.1's
// "query reads the current partial week plus the tail of the previous
// week" (only two rows read per muscle).
export function computeRecencyMap(store: MuscleRollupStore, nowMs: number): RecencyMapEntry[] {
  const currentWeekStart = weekStartFor(nowMs);
  const previousWeekStart = addWeeks(currentWeekStart, -1);

  return MUSCLES.map((muscle) => {
    const currentRow = store.get(muscle.id, currentWeekStart);
    const previousRow = store.get(muscle.id, previousWeekStart);

    const freshness = decayedRowVolume(currentRow, nowMs, muscle.tauDays) + decayedRowVolume(previousRow, nowMs, muscle.tauDays);

    const trailingWeekStarts = Array.from({ length: TRAILING_AVERAGE_WEEKS }, (_, i) => addWeeks(previousWeekStart, -i));
    const trailingRows = trailingWeekStarts.map((ws) => store.get(muscle.id, ws)).filter((r): r is MuscleWeekRollupRow => r !== undefined);
    const trailingAverage = average(trailingRows.map((r) => r.totalVolume));

    const denominator = Math.max(trailingAverage, muscle.volumeFloor);
    const heat = denominator > 0 ? Math.min(1, freshness / denominator) : 0;

    const lastTrainedAt = maxOrNull(currentRow?.lastTrainedAt, previousRow?.lastTrainedAt);

    return {
      muscleId: muscle.id,
      heat,
      freshness,
      trailingAverage,
      daysSinceTrained: lastTrainedAt === null ? null : (nowMs - lastTrainedAt) / MS_PER_DAY,
    };
  });
}

function maxOrNull(...values: Array<number | null | undefined>): number | null {
  const real = values.filter((v): v is number => v !== null && v !== undefined);
  return real.length > 0 ? Math.max(...real) : null;
}

// ---- 6.2 Weekly map ----

export interface WeeklyMuscleEntry {
  muscleId: MuscleId;
  volume: number;
  share: number; // 0-1
}

export interface WeeklyGroupEntry {
  groupId: GroupId;
  volume: number;
  color: number; // volume-weighted mean of child shares, 0-1
  percentage: number; // sum of child shares, 0-1
}

export interface WeeklyMap {
  weekStart: string;
  totalVolume: number;
  muscles: WeeklyMuscleEntry[];
  groups: WeeklyGroupEntry[];
}

export function computeWeeklyMap(store: MuscleRollupStore, weekStart: string): WeeklyMap {
  const rows = MUSCLES.map((m) => store.get(m.id, weekStart));
  const totalVolume = rows.reduce((sum, r) => sum + (r?.totalVolume ?? 0), 0);

  const muscles: WeeklyMuscleEntry[] = MUSCLES.map((m, i) => {
    const volume = rows[i]?.totalVolume ?? 0;
    return { muscleId: m.id, volume, share: totalVolume > 0 ? volume / totalVolume : 0 };
  });

  const groups: WeeklyGroupEntry[] = GROUPS.map((g) => {
    const children = muscles.filter((m) => getMuscle(m.muscleId).groupId === g.id);
    const volume = children.reduce((sum, c) => sum + c.volume, 0);
    const color = volumeWeightedMean(children.map((c) => ({ value: c.share, volume: c.volume })));
    const percentage = children.reduce((sum, c) => sum + c.share, 0);
    return { groupId: g.id, volume, color, percentage };
  });

  return { weekStart, totalVolume, muscles, groups };
}

// ---- 6.3 Diff view ----

export interface DiffMuscleEntry {
  muscleId: MuscleId;
  shareA: number;
  shareB: number;
  deltaShare: number;
  volumeA: number;
  volumeB: number;
  deltaVolume: number;
}

export interface DiffView {
  weekStartA: string;
  weekStartB: string;
  totalVolumeA: number;
  totalVolumeB: number;
  muscles: DiffMuscleEntry[];
}

export function computeDiffView(store: MuscleRollupStore, weekStartA: string, weekStartB: string): DiffView {
  const mapA = computeWeeklyMap(store, weekStartA);
  const mapB = computeWeeklyMap(store, weekStartB);

  const muscles: DiffMuscleEntry[] = MUSCLES.map((m) => {
    const a = mapA.muscles.find((x) => x.muscleId === m.id)!;
    const b = mapB.muscles.find((x) => x.muscleId === m.id)!;
    return {
      muscleId: m.id,
      shareA: a.share,
      shareB: b.share,
      deltaShare: b.share - a.share,
      volumeA: a.volume,
      volumeB: b.volume,
      deltaVolume: b.volume - a.volume,
    };
  });

  return { weekStartA, weekStartB, totalVolumeA: mapA.totalVolume, totalVolumeB: mapB.totalVolume, muscles };
}

// ---- §8 registry-authoring integrity check ----
// "A muscle with zero exercises mapped to it renders permanently
// untrained... this is a data bug, not a user state." Exposed so it can be
// asserted in tests against the real catalog's exercise.muscles arrays.
export function findUnmappedMuscles(allExerciseMuscles: MuscleContribution[][]): MuscleId[] {
  const mapped = new Set<MuscleId>();
  for (const contributions of allExerciseMuscles) {
    for (const c of contributions) {
      if (c.share > 0) mapped.add(c.muscle);
    }
  }
  return MUSCLES.map((m) => m.id).filter((id) => !mapped.has(id));
}
