import { createSessionRepository } from "./repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "./repositories/sessionExerciseRepository.js";
import { createSetRepository } from "./repositories/setRepository.js";
import { createBodyweightRepository } from "./repositories/bodyweightRepository.js";
import type { GymDatabase } from "./db.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// mulberry32 — a small, well-known seedable PRNG. JS's Math.random() isn't
// seedable, so a deterministic generator needs its own. Same seed always
// produces the same sequence, which is the whole point (§12 task 17):
// reproducible fixture data for golden-file tests, not just dev seeding.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SplitExercise {
  exerciseId: string;
  sets: number;
  targetReps: number;
  startWeightKg: number;
}
interface SplitDay {
  exercises: SplitExercise[];
}

// A standard push/pull/legs split, 3 sessions/week — realistic enough to
// exercise progressive overload (PR detection), multi-muscle XP
// accumulation, streaks/gaps, and a multi-week span for cache-rebuild and
// export/import regression fixtures.
const SPLIT: SplitDay[] = [
  {
    exercises: [
      { exerciseId: "barbell-bench-press", sets: 3, targetReps: 8, startWeightKg: 60 },
      { exerciseId: "overhead-press", sets: 3, targetReps: 8, startWeightKg: 35 },
    ],
  },
  {
    exercises: [
      { exerciseId: "barbell-row", sets: 3, targetReps: 8, startWeightKg: 55 },
      { exerciseId: "lat-pulldown", sets: 3, targetReps: 10, startWeightKg: 50 },
    ],
  },
  {
    exercises: [
      { exerciseId: "back-squat", sets: 3, targetReps: 6, startWeightKg: 70 },
      { exerciseId: "leg-press", sets: 3, targetReps: 10, startWeightKg: 120 },
    ],
  },
];

export interface DevSeedOptions {
  // Same seed (+ the same other options) always produces the same
  // history — this is what makes the output usable as a golden fixture.
  seed?: number;
  // Epoch ms of the first session. Pass an explicit value for
  // reproducible output — the Date.now()-based default is a dev
  // convenience only and is never the same twice.
  startedAt?: number;
  weeks?: number;
  startBodyweightKg?: number;
}

export interface DevSeedResult {
  sessionCount: number;
  skippedSessionCount: number;
  setCount: number;
  bodyweightEntryCount: number;
}

// ~2%/week progressive overload, rounded to the nearest 2.5kg plate.
function progressedWeight(startWeightKg: number, week: number): number {
  const raw = startWeightKg * Math.pow(1.02, week);
  return Math.round(raw / 2.5) * 2.5;
}

export async function seedDevHistory(db: GymDatabase, options: DevSeedOptions = {}): Promise<DevSeedResult> {
  const weeks = options.weeks ?? 12;
  const startedAt = options.startedAt ?? Date.now() - weeks * WEEK;
  const startBodyweightKg = options.startBodyweightKg ?? 80;
  const rng = mulberry32(options.seed ?? 42);

  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const sets = createSetRepository(db);
  const bodyweight = createBodyweightRepository(db);

  const result: DevSeedResult = { sessionCount: 0, skippedSessionCount: 0, setCount: 0, bodyweightEntryCount: 0 };

  for (let week = 0; week < weeks; week++) {
    for (let dayIndex = 0; dayIndex < SPLIT.length; dayIndex++) {
      const day = SPLIT[dayIndex]!;
      const sessionStart = startedAt + week * WEEK + dayIndex * 2 * DAY;
      const bodyweightKg = Math.round((startBodyweightKg + week * 0.15 + (rng() - 0.5) * 0.6) * 10) / 10;

      await bodyweight.log({ bodyweightKg, recordedAt: sessionStart });
      result.bodyweightEntryCount++;

      // ~8% chance of a missed session (life happens) — realistic gaps for
      // streak/consistency features to exercise against.
      if (rng() < 0.08) {
        result.skippedSessionCount++;
        continue;
      }

      const session = await sessions.create({ startedAt: sessionStart });
      result.sessionCount++;

      let loggedAt = sessionStart;
      for (let exIdx = 0; exIdx < day.exercises.length; exIdx++) {
        const exercise = day.exercises[exIdx]!;
        const se = await sessionExercises.add({ sessionId: session.id, exerciseId: exercise.exerciseId });
        const weightKg = progressedWeight(exercise.startWeightKg, week);

        // One light warmup set before the working sets, most of the time.
        if (rng() < 0.6) {
          await sets.log({
            sessionExerciseId: se.id,
            weightKg: Math.round((weightKg * 0.5) / 2.5) * 2.5,
            reps: exercise.targetReps,
            bodyweightKgAtTime: bodyweightKg,
            loggedAt,
            isWarmup: true,
          });
          result.setCount++;
          loggedAt += 60_000;
        }

        for (let setIdx = 0; setIdx < exercise.sets; setIdx++) {
          const repVariance = Math.floor((rng() - 0.5) * 3); // typically -1, 0, or +1
          const reps = Math.max(1, exercise.targetReps + repVariance);
          // A rare failed attempt on the very last working set of the
          // session — never anywhere else, so every session still has
          // plenty of real completed sets.
          const isLastSetOfSession = exIdx === day.exercises.length - 1 && setIdx === exercise.sets - 1;
          const completed = !(isLastSetOfSession && rng() < 0.05);

          await sets.log({ sessionExerciseId: se.id, weightKg, reps, bodyweightKgAtTime: bodyweightKg, loggedAt, completed });
          result.setCount++;
          loggedAt += 90_000;
        }
      }
      await sessions.finish(session.id, loggedAt);
    }
  }

  return result;
}
