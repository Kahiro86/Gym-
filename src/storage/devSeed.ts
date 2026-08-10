import { createSessionRepository } from "./repositories/sessionRepository.js";
import { createSetRepository } from "./repositories/setRepository.js";
import { createBodyweightRepository } from "./repositories/bodyweightRepository.js";
import type { GymDatabase } from "./db.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

interface SplitExercise {
  exerciseId: string;
  sets: number;
  reps: number;
  startWeightKg: number;
}

interface SplitDay {
  exercises: SplitExercise[];
}

// A standard push/pull/legs split, 3 sessions/week — realistic enough to
// exercise progressive overload (PR detection), multi-muscle XP
// accumulation, and a 12-week span for cache-rebuild and export/import
// regression fixtures.
const SPLIT: SplitDay[] = [
  {
    exercises: [
      { exerciseId: "barbell-bench-press", sets: 3, reps: 8, startWeightKg: 60 },
      { exerciseId: "overhead-press", sets: 3, reps: 8, startWeightKg: 35 },
    ],
  },
  {
    exercises: [
      { exerciseId: "barbell-row", sets: 3, reps: 8, startWeightKg: 55 },
      { exerciseId: "lat-pulldown", sets: 3, reps: 10, startWeightKg: 50 },
    ],
  },
  {
    exercises: [
      { exerciseId: "back-squat", sets: 3, reps: 6, startWeightKg: 70 },
      { exerciseId: "leg-press", sets: 3, reps: 10, startWeightKg: 120 },
    ],
  },
];

export interface DevSeedOptions {
  // Epoch ms of the first session. Pass an explicit value for reproducible
  // (golden-file) output — the Date.now()-based default is a dev
  // convenience only and is never the same twice.
  startedAt?: number;
  weeks?: number;
  startBodyweightKg?: number;
}

export interface DevSeedResult {
  sessionCount: number;
  setCount: number;
  bodyweightEntryCount: number;
}

// ~2%/week progressive overload, rounded to the nearest 2.5kg plate — no
// randomness anywhere in this module, so the same options always produce
// the same history.
function progressedWeight(startWeightKg: number, week: number): number {
  const raw = startWeightKg * Math.pow(1.02, week);
  return Math.round(raw / 2.5) * 2.5;
}

export async function seedDevHistory(db: GymDatabase, options: DevSeedOptions = {}): Promise<DevSeedResult> {
  const weeks = options.weeks ?? 12;
  const startedAt = options.startedAt ?? Date.now() - weeks * WEEK;
  const startBodyweightKg = options.startBodyweightKg ?? 80;

  const sessions = createSessionRepository(db);
  const sets = createSetRepository(db);
  const bodyweight = createBodyweightRepository(db);

  const result: DevSeedResult = { sessionCount: 0, setCount: 0, bodyweightEntryCount: 0 };

  for (let week = 0; week < weeks; week++) {
    for (let dayIndex = 0; dayIndex < SPLIT.length; dayIndex++) {
      const day = SPLIT[dayIndex]!;
      // Mon/Wed/Fri-style spacing: 3 sessions spread across each 7-day week.
      const sessionStart = startedAt + week * WEEK + dayIndex * 2 * DAY;
      // Slow drift + a small deterministic wobble by day — no Math.random.
      const bodyweightKg = startBodyweightKg + week * 0.15 + (dayIndex - 1) * 0.2;

      await bodyweight.log({ bodyweightKg, recordedAt: sessionStart });
      result.bodyweightEntryCount++;

      const session = await sessions.create({ startedAt: sessionStart });
      result.sessionCount++;

      let loggedAt = sessionStart;
      for (const exercise of day.exercises) {
        const weightKg = progressedWeight(exercise.startWeightKg, week);
        for (let setIdx = 0; setIdx < exercise.sets; setIdx++) {
          await sets.log({
            sessionId: session.id,
            exerciseId: exercise.exerciseId,
            weightKg,
            reps: exercise.reps,
            bodyweightKgAtTime: bodyweightKg,
            loggedAt,
          });
          result.setCount++;
          loggedAt += 90_000; // ~90s between sets
        }
      }
      await sessions.finish(session.id, loggedAt);
    }
  }

  return result;
}
