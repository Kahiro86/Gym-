import type { HeatmapMuscleId } from "./registry.js";

// §4: cardio contributes via a separate path from lifting, using its own
// modality -> muscle weight map and a per-minute conversion constant.

export type CardioModality = "run" | "cycle" | "row" | "swim" | "elliptical";

export interface CardioModalityWeight {
  modality: CardioModality;
  muscle: HeatmapMuscleId;
  weight: number; // 0-1, shares within one modality sum to 1.0
}

export const CARDIO_MODALITY_MAP: CardioModalityWeight[] = [
  { modality: "run", muscle: "quads", weight: 0.35 },
  { modality: "run", muscle: "hamstrings", weight: 0.25 },
  { modality: "run", muscle: "calves", weight: 0.25 },
  { modality: "run", muscle: "glutes", weight: 0.15 },

  { modality: "cycle", muscle: "quads", weight: 0.55 },
  { modality: "cycle", muscle: "hamstrings", weight: 0.2 },
  { modality: "cycle", muscle: "calves", weight: 0.15 },
  { modality: "cycle", muscle: "glutes", weight: 0.1 },

  { modality: "row", muscle: "back", weight: 0.3 },
  { modality: "row", muscle: "quads", weight: 0.2 },
  { modality: "row", muscle: "hamstrings", weight: 0.15 },
  { modality: "row", muscle: "biceps", weight: 0.15 },
  { modality: "row", muscle: "lowerBack", weight: 0.1 },
  { modality: "row", muscle: "forearms", weight: 0.1 },

  { modality: "swim", muscle: "back", weight: 0.3 },
  { modality: "swim", muscle: "pecSternal", weight: 0.2 },
  { modality: "swim", muscle: "deltAnterior", weight: 0.15 },
  { modality: "swim", muscle: "tricepsLateral", weight: 0.15 },
  { modality: "swim", muscle: "abs", weight: 0.1 },
  { modality: "swim", muscle: "calves", weight: 0.1 },

  { modality: "elliptical", muscle: "quads", weight: 0.35 },
  { modality: "elliptical", muscle: "glutes", weight: 0.25 },
  { modality: "elliptical", muscle: "hamstrings", weight: 0.2 },
  { modality: "elliptical", muscle: "calves", weight: 0.2 },
];

export interface CardioConversion {
  modality: CardioModality;
  volumePerMinuteAtReferenceIntensity: number;
}

export const CARDIO_CONVERSION: CardioConversion[] = [
  { modality: "run", volumePerMinuteAtReferenceIntensity: 120 },
  { modality: "cycle", volumePerMinuteAtReferenceIntensity: 100 },
  { modality: "row", volumePerMinuteAtReferenceIntensity: 140 },
  { modality: "swim", volumePerMinuteAtReferenceIntensity: 110 },
  { modality: "elliptical", volumePerMinuteAtReferenceIntensity: 90 },
];

// §7: TBD tuning constant. Placeholder until real usage data exists.
export const CARDIO_CAP = 0.5;

export interface CardioSessionInput {
  modality: CardioModality;
  durationMin: number;
  intensityFactor: number; // 1.0 = reference intensity
  timestampMs: number;
}

export function computeCardioMuscleVolume(input: CardioSessionInput): Partial<Record<HeatmapMuscleId, number>> {
  const conversion = CARDIO_CONVERSION.find((c) => c.modality === input.modality);
  if (!conversion) {
    throw new Error(`Unknown cardio modality: ${input.modality}`);
  }

  const volumeEquiv = input.durationMin * input.intensityFactor * conversion.volumePerMinuteAtReferenceIntensity;
  const weights = CARDIO_MODALITY_MAP.filter((w) => w.modality === input.modality);

  const result: Partial<Record<HeatmapMuscleId, number>> = {};
  for (const w of weights) {
    result[w.muscle] = volumeEquiv * w.weight;
  }
  return result;
}
