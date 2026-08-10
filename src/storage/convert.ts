import type { LoggedSet } from "../domain/types.js";
import type { SetRecord } from "./types.js";

// SetRecord (storage row) -> LoggedSet (Layer 1 input). Shared by every
// repository that replays sets through domain functions — set writes and
// derived-cache rebuilds must convert identically.
export function toLoggedSet(record: SetRecord): LoggedSet {
  return {
    exerciseId: record.exerciseId,
    weightKg: record.weightKg ?? undefined,
    reps: record.reps ?? undefined,
    durationSec: record.durationSec ?? undefined,
    distanceM: record.distanceM ?? undefined,
    rpe: record.rpe ?? undefined,
    bodyweightKg: record.bodyweightKgAtTime,
    timestamp: record.loggedAt,
  };
}
