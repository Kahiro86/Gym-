import { computeSetVolume } from "./load.js";
import { detectPrs, recordSetIntoHistory } from "./prs.js";
import { requireExercise } from "./registry.js";
import { MUSCLE_IDS } from "./types.js";
import type {
  Exercise,
  ExerciseHistory,
  LoggedSet,
  MuscleId,
  Pr,
  PrType,
  SessionInput,
  SessionXpResult,
  XpBreakdown,
  XpComponent,
} from "./types.js";

export const XP_CONSTANT = 10;

const PR_BONUS: Record<PrType, number> = {
  weight: 15,
  rep: 10,
  volume: 10,
};

const PR_LABEL: Record<PrType, string> = {
  weight: "weight PR",
  rep: "rep PR",
  volume: "volume PR",
};

const SESSION_FIRST_BONUS = 5;
export const WEEKLY_TARGET_BONUS = 50;

const DIMINISHING_BRACKETS: Array<{ below: number; multiplier: number }> = [
  { below: 3, multiplier: 1.0 },
  { below: 5, multiplier: 0.8 },
  { below: 8, multiplier: 0.55 },
  { below: Infinity, multiplier: 0.3 },
];

export function diminishingMultiplierFor(accumulatedEffectiveSets: number): number {
  const bracket = DIMINISHING_BRACKETS.find((b) => accumulatedEffectiveSets < b.below);
  return bracket ? bracket.multiplier : 0.3;
}

export function streakMultiplier(streakWeeks: number): number {
  return 1 + 0.05 * Math.min(Math.max(streakWeeks, 0), 4);
}

export interface SetXpContext {
  bodyweightKg: number;
  prs: Pr[];
  isFirstSetOfDay: boolean;
  diminishingMultiplier: number;
  accumulatedEffectiveSets: number;
}

export function computeSetXp(exercise: Exercise, set: LoggedSet, context: SetXpContext): XpBreakdown {
  const volume = computeSetVolume(exercise, set, context.bodyweightKg);
  const rawBase = XP_CONSTANT * Math.sqrt(volume / exercise.referenceVolume);
  const base = Math.round(rawBase);

  const components: XpComponent[] = [];

  for (const pr of context.prs) {
    components.push({
      label: PR_LABEL[pr.type],
      amount: PR_BONUS[pr.type],
      reason: `new ${pr.type} PR (${pr.previousBest} → ${pr.value})`,
    });
  }

  if (context.isFirstSetOfDay) {
    components.push({
      label: "session first",
      amount: SESSION_FIRST_BONUS,
      reason: "first set of the day",
    });
  }

  const preMultiplierTotal = base + components.reduce((sum, c) => sum + c.amount, 0);
  const multiplier = context.diminishingMultiplier;
  const total = Math.max(0, Math.round(preMultiplierTotal * multiplier));

  if (multiplier < 1) {
    components.push({
      label: `×${multiplier.toFixed(2)}`,
      amount: total - preMultiplierTotal,
      reason: `diminishing returns (${context.accumulatedEffectiveSets.toFixed(1)} effective sets this session)`,
    });
  }

  return { total, base, components };
}

function emptyMuscleRecord(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) {
    record[muscle] = 0;
  }
  return record;
}

export function computeSessionXp(session: SessionInput): SessionXpResult {
  const runningHistory: Record<string, ExerciseHistory> = { ...session.history.exerciseHistory };
  const muscleEffectiveSets = emptyMuscleRecord();
  const muscleXp = emptyMuscleRecord();

  const setBreakdowns: XpBreakdown[] = [];
  const allPrs: Pr[] = [];
  let total = 0;

  session.sets.forEach((set, index) => {
    const exercise = requireExercise(set.exerciseId);
    const prs = detectPrs(exercise, set, runningHistory[exercise.id], session.bodyweightKg);
    allPrs.push(...prs);

    const perMuscleMultiplier = exercise.muscles.reduce(
      (sum, contribution) =>
        sum + contribution.share * diminishingMultiplierFor(muscleEffectiveSets[contribution.muscle]),
      0
    );

    const accumulatedEffectiveSets = exercise.muscles.reduce(
      (sum, contribution) => sum + contribution.share * muscleEffectiveSets[contribution.muscle],
      0
    );

    const isFirstSetOfDay = index === 0 && session.history.isFirstSessionOfDay;

    const breakdown = computeSetXp(exercise, set, {
      bodyweightKg: session.bodyweightKg,
      prs,
      isFirstSetOfDay,
      diminishingMultiplier: perMuscleMultiplier,
      accumulatedEffectiveSets,
    });

    setBreakdowns.push(breakdown);
    total += breakdown.total;

    for (const contribution of exercise.muscles) {
      muscleXp[contribution.muscle] += breakdown.total * contribution.share;
      muscleEffectiveSets[contribution.muscle] += contribution.share;
    }

    runningHistory[exercise.id] = recordSetIntoHistory(
      exercise,
      set,
      runningHistory[exercise.id],
      session.bodyweightKg
    );
  });

  const sessionBonusComponents: XpComponent[] = [];

  if (session.history.completesWeeklyTarget) {
    sessionBonusComponents.push({
      label: "weekly target",
      amount: WEEKLY_TARGET_BONUS,
      reason: "completed the weekly target",
    });
    total += WEEKLY_TARGET_BONUS;
  }

  const streakMult = streakMultiplier(session.history.streakWeeks);
  if (streakMult > 1) {
    const beforeStreak = total;
    total = Math.round(total * streakMult);
    sessionBonusComponents.push({
      label: `×${streakMult.toFixed(2)} streak`,
      amount: total - beforeStreak,
      reason: `${session.history.streakWeeks}-week streak`,
    });
  }

  return {
    total: Math.max(0, total),
    setBreakdowns,
    muscleXp,
    prs: allPrs,
    sessionBonusComponents,
    updatedExerciseHistory: runningHistory,
  };
}
