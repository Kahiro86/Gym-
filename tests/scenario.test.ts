import { describe, it, expect } from "vitest";
import { computeSessionXp } from "../src/domain/xp.js";
import { levelFromTotalXp, rankForMuscleXp, xpRequiredForLevel } from "../src/domain/progression.js";
import { requireExercise } from "../src/domain/catalog.js";
import { emptyExerciseHistory, MUSCLE_IDS } from "../src/domain/types.js";
import type { ExerciseHistory, HistoryContext, LoggedSet, SessionInput } from "../src/domain/types.js";

const BW = 80;

function freshHistory(exerciseIds: string[], overrides: Partial<HistoryContext> = {}): HistoryContext {
  const exerciseHistory: Record<string, ExerciseHistory> = {};
  for (const id of exerciseIds) exerciseHistory[id] = emptyExerciseHistory();
  return {
    exerciseHistory,
    isFirstSessionOfDay: true,
    streakWeeks: 0,
    ...overrides,
  };
}

describe("scenario — realistic first session produces a level-up", () => {
  it("3 exercises, 9 sets on day one crosses level 1's XP requirement", () => {
    const pushup = requireExercise("pushup");
    const squat = requireExercise("bodyweight-squat");
    const plank = requireExercise("plank");

    const sets: LoggedSet[] = [
      ...Array.from({ length: 3 }, (_, i) => ({ exerciseId: pushup.id, reps: 15, bodyweightKg: BW, timestamp: i })),
      ...Array.from({ length: 3 }, (_, i) => ({ exerciseId: squat.id, reps: 15, bodyweightKg: BW, timestamp: 3 + i })),
      ...Array.from({ length: 3 }, (_, i) => ({ exerciseId: plank.id, durationSec: 40, bodyweightKg: BW, timestamp: 6 + i })),
    ];

    const session: SessionInput = { sets };
    const history = freshHistory([pushup.id, squat.id, plank.id]);

    const result = computeSessionXp(session, history);
    expect(result.total).toBeGreaterThanOrEqual(xpRequiredForLevel(1));

    const progress = levelFromTotalXp(result.total);
    expect(progress.level).toBeGreaterThanOrEqual(2);

    const trainedMuscle = Object.entries(result.muscleXp).find(([, xp]) => xp > 0);
    expect(trainedMuscle).toBeDefined();
    const [, xp] = trainedMuscle!;
    expect(rankForMuscleXp(xp)).not.toBe("unranked");
  });
});

describe("scenario — comparable effort across rep ranges", () => {
  it("a 5x5 and a 3x12 session of comparable relative intensity land within ~20% of each other", () => {
    const squat = requireExercise("back-squat");
    const noPrHistory = (): HistoryContext => ({
      exerciseHistory: {
        [squat.id]: {
          maxWeightKg: 100_000,
          maxVolumeSingleSet: 100_000_000,
          repsAtLoad: [{ loadKg: 100_000, reps: 100_000 }],
        },
      },
      isFirstSessionOfDay: false,
      streakWeeks: 0,
    });

    const fiveByFive: SessionInput = {
      sets: Array.from({ length: 5 }, (_, i) => ({ exerciseId: squat.id, weightKg: 122, reps: 5, bodyweightKg: BW, timestamp: i })),
    };
    const threeByTwelve: SessionInput = {
      sets: Array.from({ length: 3 }, (_, i) => ({ exerciseId: squat.id, weightKg: 98, reps: 12, bodyweightKg: BW, timestamp: i })),
    };

    const a = computeSessionXp(fiveByFive, noPrHistory()).total;
    const b = computeSessionXp(threeByTwelve, noPrHistory()).total;

    const ratio = Math.max(a, b) / Math.min(a, b);
    expect(ratio).toBeLessThanOrEqual(1.2);
  });
});

describe("golden file — 12-week training log", () => {
  it("produces a stable snapshot of levels, ranks, and PR counts", () => {
    const exerciseIds = ["back-squat", "barbell-bench-press", "barbell-row", "pushup", "plank"];
    let history: HistoryContext = freshHistory(exerciseIds);
    let totalXp = 0;
    let sessionCount = 0;
    let prCount = 0;
    const muscleXpTotals: Record<string, number> = {};
    for (const muscle of MUSCLE_IDS) muscleXpTotals[muscle] = 0;

    // Deterministic 12-week log: 3 sessions/week, linear progression, no RNG.
    for (let week = 0; week < 12; week++) {
      for (let day = 0; day < 3; day++) {
        sessionCount++;
        const squatWeight = 60 + week * 2;
        const benchWeight = 40 + week * 1.5;
        const rowWeight = 45 + week * 1.5;

        const sets: LoggedSet[] = [
          { exerciseId: "back-squat", weightKg: squatWeight, reps: 5, bodyweightKg: BW, timestamp: sessionCount * 10 },
          { exerciseId: "back-squat", weightKg: squatWeight, reps: 5, bodyweightKg: BW, timestamp: sessionCount * 10 + 1 },
          { exerciseId: "back-squat", weightKg: squatWeight, reps: 5, bodyweightKg: BW, timestamp: sessionCount * 10 + 2 },
          { exerciseId: "barbell-bench-press", weightKg: benchWeight, reps: 8, bodyweightKg: BW, timestamp: sessionCount * 10 + 3 },
          { exerciseId: "barbell-bench-press", weightKg: benchWeight, reps: 8, bodyweightKg: BW, timestamp: sessionCount * 10 + 4 },
          { exerciseId: "barbell-row", weightKg: rowWeight, reps: 8, bodyweightKg: BW, timestamp: sessionCount * 10 + 5 },
          { exerciseId: "barbell-row", weightKg: rowWeight, reps: 8, bodyweightKg: BW, timestamp: sessionCount * 10 + 6 },
          { exerciseId: "pushup", reps: 15 + week, bodyweightKg: BW, timestamp: sessionCount * 10 + 7 },
          { exerciseId: "plank", durationSec: 45 + week, bodyweightKg: BW, timestamp: sessionCount * 10 + 8 },
        ];

        const session: SessionInput = { sets };
        const sessionHistory: HistoryContext = { ...history, isFirstSessionOfDay: day === 0 };

        const result = computeSessionXp(session, sessionHistory);
        totalXp += result.total;
        prCount += result.prs.length;
        for (const muscle of MUSCLE_IDS) muscleXpTotals[muscle]! += result.muscleXp[muscle];

        history = {
          ...history,
          exerciseHistory: result.updatedExerciseHistory,
          bodyweightHistory: result.updatedBodyweightHistory,
        };
      }
    }

    const finalLevel = levelFromTotalXp(totalXp);
    const finalRanks = Object.fromEntries(
      MUSCLE_IDS.map((muscle) => [muscle, rankForMuscleXp(muscleXpTotals[muscle]!)])
    );

    expect({
      sessionCount,
      totalXp: Math.round(totalXp),
      finalLevel: finalLevel.level,
      prCount,
      finalRanks,
    }).toMatchSnapshot();
  });
});
