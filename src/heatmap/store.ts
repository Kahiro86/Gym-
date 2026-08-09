import { MUSCLES, getMuscle } from "../domain/muscles.js";
import { computeCardioMuscleVolume, CARDIO_CAP } from "../domain/cardio.js";
import { computeSetMuscleVolumes } from "./volume.js";
import type { MuscleId } from "../domain/muscles.js";
import type { CardioLog } from "../domain/cardio.js";
import type { LoggedSet } from "../domain/types.js";

// §5: single rollup table, keyed (muscle_id, week_start). Decay and
// normalization are never stored (§5) — only these raw components — so
// changing tau_days or volume_floor never requires a backfill.

const MS_PER_DAY = 86_400_000;

export function weekStartFor(timestampMs: number): string {
  const date = new Date(timestampMs);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = utc.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday);
  return isoDate(utc);
}

export function addWeeks(weekStart: string, weeks: number): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return isoDate(date);
}

function isoDate(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

export interface MuscleWeekRollupRow {
  muscleId: MuscleId;
  weekStart: string; // Monday, ISO date
  totalVolume: number; // flat, no decay applied (§5)
  liftingVolume: number; // excl. cardio, for cap math
  cardioVolume: number;
  setCount: number;
  sessionCount: number;
  lastTrainedAt: number | null; // epoch ms
}

function emptyRow(muscleId: MuscleId, weekStart: string): MuscleWeekRollupRow {
  return {
    muscleId,
    weekStart,
    totalVolume: 0,
    liftingVolume: 0,
    cardioVolume: 0,
    setCount: 0,
    sessionCount: 0,
    lastTrainedAt: null,
  };
}

export interface MuscleRollupStore {
  upsert(row: MuscleWeekRollupRow): void;
  get(muscleId: MuscleId, weekStart: string): MuscleWeekRollupRow | undefined;
  getWeek(weekStart: string): MuscleWeekRollupRow[];
  getRange(muscleId: MuscleId, fromWeekStart: string, toWeekStart: string): MuscleWeekRollupRow[];
  delete(muscleId: MuscleId, weekStart: string): void;
}

// Reference implementation matching the spec's schema/semantics exactly —
// swappable for real SQLite/Postgres/Supabase later without touching
// callers, since they only ever see the MuscleRollupStore interface.
export class InMemoryMuscleRollupStore implements MuscleRollupStore {
  private rows = new Map<string, MuscleWeekRollupRow>();

  private key(muscleId: MuscleId, weekStart: string): string {
    return `${muscleId}::${weekStart}`;
  }

  upsert(row: MuscleWeekRollupRow): void {
    this.rows.set(this.key(row.muscleId, row.weekStart), row);
  }

  get(muscleId: MuscleId, weekStart: string): MuscleWeekRollupRow | undefined {
    return this.rows.get(this.key(muscleId, weekStart));
  }

  getWeek(weekStart: string): MuscleWeekRollupRow[] {
    return MUSCLES.map((m) => this.get(m.id, weekStart)).filter((row): row is MuscleWeekRollupRow => row !== undefined);
  }

  getRange(muscleId: MuscleId, fromWeekStart: string, toWeekStart: string): MuscleWeekRollupRow[] {
    const results: MuscleWeekRollupRow[] = [];
    let cursor = fromWeekStart;
    while (cursor <= toWeekStart) {
      const row = this.get(muscleId, cursor);
      if (row) results.push(row);
      cursor = addWeeks(cursor, 1);
    }
    return results;
  }

  delete(muscleId: MuscleId, weekStart: string): void {
    this.rows.delete(this.key(muscleId, weekStart));
  }
}

export interface HeatmapSessionInput {
  sets: LoggedSet[]; // each set carries its own bodyweightKg (v2 §3.5)
  cardio?: CardioLog[];
}

function sessionStartMs(session: HeatmapSessionInput): number | undefined {
  const timestamps = [...session.sets.map((s) => s.timestamp), ...(session.cardio?.map((c) => c.timestampMs) ?? [])];
  return timestamps.length > 0 ? Math.min(...timestamps) : undefined;
}

// §5 write path: "On session save -> upsert affected rows." A whole
// session lands in exactly one week bucket, determined by its start (the
// earliest set/cardio timestamp) — so a session that runs past midnight
// still counts as one atomic unit (§11: "session spanning midnight lands
// in the correct week bucket").
export function applySessionToRollup(store: MuscleRollupStore, session: HeatmapSessionInput): void {
  const startMs = sessionStartMs(session);
  if (startMs === undefined) return;

  const weekStart = weekStartFor(startMs);
  const touchedThisSession = new Set<MuscleId>();

  for (const set of session.sets) {
    const contributions = computeSetMuscleVolumes(set);
    for (const [muscleId, volume] of Object.entries(contributions) as [MuscleId, number][]) {
      if (!volume || volume <= 0) continue;
      const existing = store.get(muscleId, weekStart) ?? emptyRow(muscleId, weekStart);
      store.upsert({
        ...existing,
        liftingVolume: existing.liftingVolume + volume,
        totalVolume: existing.totalVolume + volume,
        setCount: existing.setCount + 1,
        sessionCount: existing.sessionCount + (touchedThisSession.has(muscleId) ? 0 : 1),
        lastTrainedAt: Math.max(existing.lastTrainedAt ?? 0, startMs),
      });
      touchedThisSession.add(muscleId);
    }
  }

  for (const cardioEntry of session.cardio ?? []) {
    const rawVolumes = computeCardioMuscleVolume(cardioEntry);
    for (const [muscleId, rawVolume] of Object.entries(rawVolumes) as [MuscleId, number][]) {
      if (!rawVolume || rawVolume <= 0) continue;
      const existing = store.get(muscleId, weekStart) ?? emptyRow(muscleId, weekStart);
      const volumeFloor = getMuscle(muscleId).volumeFloor;
      // §4 hard cap: cardio can't swamp a muscle's weekly heat. "Floored"
      // per §4/§7 means the cap uses at least volume_floor as its lifting
      // basis, so a muscle with near-zero lifting this week still gets a
      // sane (non-degenerate) cardio allowance.
      const cap = CARDIO_CAP * Math.max(existing.liftingVolume, volumeFloor);
      const room = Math.max(0, cap - existing.cardioVolume);
      const applied = Math.min(rawVolume, room);
      if (applied <= 0) continue;

      store.upsert({
        ...existing,
        cardioVolume: existing.cardioVolume + applied,
        totalVolume: existing.totalVolume + applied,
        sessionCount: existing.sessionCount + (touchedThisSession.has(muscleId) ? 0 : 1),
        lastTrainedAt: Math.max(existing.lastTrainedAt ?? 0, cardioEntry.timestampMs),
      });
      touchedThisSession.add(muscleId);
    }
  }
}

// §5 write path: "On session edit/delete -> recompute that single week's
// affected rows." Full rebuild rather than incremental subtraction — the
// cardio cap isn't cleanly invertible, but a from-scratch replay always is.
export function recomputeWeekRollup(store: MuscleRollupStore, weekStart: string, sessionsInWeek: HeatmapSessionInput[]): void {
  for (const muscle of MUSCLES) {
    store.delete(muscle.id, weekStart);
  }
  for (const session of sessionsInWeek) {
    applySessionToRollup(store, session);
  }
}

export { MS_PER_DAY };
