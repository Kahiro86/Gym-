import type { MuscleContribution } from "./types.js";
import type { MuscleId } from "./muscles.js";

// v2 §3.7/§11: cardio is in scope, converted to a volume-equivalent that
// plugs into the same per-muscle system as lifting (§4.2's effort_m sum
// doesn't care whether volume came from a set or a cardio log).

export type CardioModalityId = "run" | "cycle" | "row" | "swim" | "elliptical";

export interface CardioModality {
  id: CardioModalityId;
  muscles: MuscleContribution[]; // shares sum to 1.0
  volumePerMinute: number; // at reference intensity (intensityFactor = 1)
}

function withPrimaryMovers(shares: Array<{ muscle: MuscleId; share: number }>): MuscleContribution[] {
  const maxShare = Math.max(...shares.map((s) => s.share));
  return shares.map((s) => ({ ...s, primaryMover: s.share >= 0.3 || s.share === maxShare }));
}

export const CARDIO_MODALITIES: CardioModality[] = [
  {
    id: "run",
    volumePerMinute: 120,
    muscles: withPrimaryMovers([
      { muscle: "quads", share: 0.35 },
      { muscle: "hamstrings", share: 0.25 },
      { muscle: "calves", share: 0.25 },
      { muscle: "glutes", share: 0.15 },
    ]),
  },
  {
    id: "cycle",
    volumePerMinute: 100,
    muscles: withPrimaryMovers([
      { muscle: "quads", share: 0.55 },
      { muscle: "hamstrings", share: 0.2 },
      { muscle: "calves", share: 0.15 },
      { muscle: "glutes", share: 0.1 },
    ]),
  },
  {
    id: "row",
    volumePerMinute: 140,
    // horizontal-pull pattern, same split archetype catalog.ts uses for rows
    muscles: withPrimaryMovers([
      { muscle: "lats", share: 0.135 },
      { muscle: "rhomboids", share: 0.165 },
      { muscle: "quads", share: 0.2 },
      { muscle: "hamstrings", share: 0.15 },
      { muscle: "biceps", share: 0.15 },
      { muscle: "lowerBack", share: 0.1 },
      { muscle: "forearms", share: 0.1 },
    ]),
  },
  {
    id: "swim",
    volumePerMinute: 110,
    muscles: withPrimaryMovers([
      { muscle: "lats", share: 0.24 },
      { muscle: "rhomboids", share: 0.06 },
      { muscle: "chestSternal", share: 0.2 },
      { muscle: "deltAnterior", share: 0.15 },
      { muscle: "tricepsLateral", share: 0.15 },
      { muscle: "abs", share: 0.1 },
      { muscle: "calves", share: 0.1 },
    ]),
  },
  {
    id: "elliptical",
    volumePerMinute: 90,
    muscles: withPrimaryMovers([
      { muscle: "quads", share: 0.35 },
      { muscle: "glutes", share: 0.25 },
      { muscle: "hamstrings", share: 0.2 },
      { muscle: "calves", share: 0.2 },
    ]),
  },
];

// §7: TBD tuning constant. Placeholder until real usage data exists.
export const CARDIO_CAP = 0.5;

const MODALITY_BY_ID = new Map(CARDIO_MODALITIES.map((m) => [m.id, m]));

export function getCardioModality(id: CardioModalityId): CardioModality {
  const modality = MODALITY_BY_ID.get(id);
  if (!modality) {
    throw new Error(`Unknown cardio modality: ${id}`);
  }
  return modality;
}

export interface CardioLog {
  modalityId: CardioModalityId;
  durationMin: number;
  intensityFactor: number; // 1.0 = reference intensity
  timestampMs: number;
}

export function computeCardioVolume(log: CardioLog): number {
  const modality = getCardioModality(log.modalityId);
  return log.durationMin * log.intensityFactor * modality.volumePerMinute;
}

export function computeCardioMuscleVolume(log: CardioLog): Partial<Record<MuscleId, number>> {
  const modality = getCardioModality(log.modalityId);
  const volumeEquiv = computeCardioVolume(log);

  const result: Partial<Record<MuscleId, number>> = {};
  for (const contribution of modality.muscles) {
    result[contribution.muscle] = volumeEquiv * contribution.share;
  }
  return result;
}
