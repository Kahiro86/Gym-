import { computeSetVolume } from "./load.js";
import { detectPrs, recordSetIntoHistory } from "./prs.js";
import { detectBodyweightPrs, recordBodyweightIntoHistory } from "./bodyweight.js";
import { requireExercise } from "./registry.js";
import { MUSCLE_IDS } from "./muscles.js";
import { emptyBodyweightHistory } from "./types.js";
import type {
  Exercise,
  ExerciseHistory,
  HistoryContext,
  MuscleId,
  Pr,
  PrType,
  SessionInput,
  SessionXpResult,
  XpBreakdown,
  XpComponent,
} from "./types.js";

// v2 §4.5: calibrated so a novice compound working set (effort spread
// across several muscles) lands around 10 XP, isolation around 6.
export const XP_CONSTANT = 6;

const PR_BONUS: Record<PrType, number> = {
  weight: 15,
  rep: 10,
  volume: 10,
  bodyweightMax: 15,
  bodyweightMin: 15,
};

const PR_LABEL: Record<PrType, string> = {
  weight: "weight PR",
  rep: "rep PR",
  volume: "volume PR",
  bodyweightMax: "bodyweight high",
  bodyweightMin: "bodyweight low",
};

// v2 §4.6: PRs used to stack to +35 on one set (3.5x a working set) and
// fired trivially against empty history on a first-ever log. The cap
// bounds the former; suppressing first-log PRs (prs.ts) and the discovery
// bonus below replace the latter.
const PR_BONUS_CAP = 20;
const DISCOVERY_BONUS = 20;
const SESSION_FIRST_BONUS = 5;

export function streakMultiplier(streakWeeks: number): number {
  return 1 + 0.05 * Math.min(Math.max(streakWeeks, 0), 4);
}

function emptyMuscleRecord(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) {
    record[muscle] = 0;
  }
  return record;
}

// v2 §4.2/§4.3: compression happens once per muscle per session, not per
// set — effort_m = Σ_sets (volume/refVol) x share_m is a plain sum, so
// splitting one exercise into more sets cannot change it, and a set's XP
// is its MARGINAL contribution to Σ_m sqrt(effort_m). §6: no rounding
// anywhere in here — round only at display, or per-set marginals won't
// sum exactly to the session total.
export function computeSessionXp(session: SessionInput, history: HistoryContext): SessionXpResult {
  const runningExerciseHistory: Record<string, ExerciseHistory> = { ...history.exerciseHistory };
  const cumulativeEffort = emptyMuscleRecord();
  const muscleXp = emptyMuscleRecord();

  const setBreakdowns: XpBreakdown[] = [];
  const allPrs: Pr[] = [];
  let total = 0;

  session.sets.forEach((set, index) => {
    const exercise = requireExercise(set.exerciseId);
    const priorHistory = runningExerciseHistory[exercise.id];
    const isFirstEverLog = priorHistory === undefined;

    const prs = isFirstEverLog ? [] : detectPrs(exercise, set, priorHistory);
    allPrs.push(...prs);

    const volume = computeSetVolume(exercise, set);
    const effortDelta = volume / exercise.referenceVolume;

    const components: XpComponent[] = [];
    let marginalBase = 0;

    for (const contribution of exercise.muscles) {
      if (contribution.share <= 0) continue;
      const before = cumulativeEffort[contribution.muscle];
      const after = before + effortDelta * contribution.share;
      cumulativeEffort[contribution.muscle] = after;

      const marginal = XP_CONSTANT * (Math.sqrt(after) - Math.sqrt(before));
      marginalBase += marginal;
      muscleXp[contribution.muscle] += marginal;

      if (marginal > 0) {
        components.push({
          label: contribution.muscle,
          amount: marginal,
          reason: `${ordinal(muscleSetCount(exercise, index, session))} ${exercise.name} set this session`,
        });
      }
    }

    const prBonusRaw = prs.reduce((sum, pr) => sum + PR_BONUS[pr.type], 0);
    for (const pr of prs) {
      components.push({
        label: PR_LABEL[pr.type],
        amount: PR_BONUS[pr.type],
        reason: `new ${pr.type} PR (${pr.previousBest} → ${pr.value})`,
      });
    }
    if (prBonusRaw > PR_BONUS_CAP) {
      components.push({
        label: "PR cap",
        amount: PR_BONUS_CAP - prBonusRaw,
        reason: `PR bonus capped at +${PR_BONUS_CAP} per set`,
      });
    }

    if (isFirstEverLog) {
      components.push({
        label: "new exercise",
        amount: DISCOVERY_BONUS,
        reason: `first-ever log of ${exercise.name}`,
      });
    }

    const isFirstSetOfDay = index === 0 && history.isFirstSessionOfDay;
    if (isFirstSetOfDay) {
      components.push({
        label: "session first",
        amount: SESSION_FIRST_BONUS,
        reason: "first set of the day",
      });
    }

    const setTotal = components.reduce((sum, c) => sum + c.amount, 0);
    total += setTotal;

    if (setTotal !== marginalBase) {
      const bonusOnlyMuscles = exercise.muscles.filter((c) => c.share > 0);
      const bonusTotal = setTotal - marginalBase;
      for (const contribution of bonusOnlyMuscles) {
        muscleXp[contribution.muscle] += bonusTotal * contribution.share;
      }
    }

    setBreakdowns.push({ total: setTotal, components });

    runningExerciseHistory[exercise.id] = recordSetIntoHistory(exercise, set, priorHistory);
  });

  const sessionBonusComponents: XpComponent[] = [];

  // v2 §3.5: bodyweight lives on the set, not the session — the session's
  // first set stands in for "the bodyweight measurement for this workout".
  const firstSetBodyweight = session.sets[0]?.bodyweightKg;
  const updatedBodyweightHistory =
    firstSetBodyweight !== undefined
      ? recordBodyweightIntoHistory(firstSetBodyweight, history.bodyweightHistory)
      : (history.bodyweightHistory ?? emptyBodyweightHistory());

  if (firstSetBodyweight !== undefined) {
    const bodyweightPrs = detectBodyweightPrs(firstSetBodyweight, history.bodyweightHistory);
    for (const pr of bodyweightPrs) {
      allPrs.push(pr);
      sessionBonusComponents.push({
        label: PR_LABEL[pr.type],
        amount: PR_BONUS[pr.type],
        reason: `new ${pr.type === "bodyweightMax" ? "highest" : "lowest"} bodyweight ever (${pr.previousBest} → ${pr.value})`,
      });
      total += PR_BONUS[pr.type];
    }
  }

  const streakMult = streakMultiplier(history.streakWeeks);
  if (streakMult > 1) {
    const beforeStreak = total;
    total = total * streakMult;
    sessionBonusComponents.push({
      label: `×${streakMult.toFixed(2)} streak`,
      amount: total - beforeStreak,
      reason: `${history.streakWeeks}-week streak`,
    });
  }

  return {
    total: Math.max(0, total),
    setBreakdowns,
    muscleXp,
    prs: allPrs,
    sessionBonusComponents,
    updatedExerciseHistory: runningExerciseHistory,
    updatedBodyweightHistory,
  };
}

// Every set logged for `exercise` trains `muscle` (the caller only calls
// this for a muscle already in exercise.muscles), so this just counts how
// many of that exercise's sets have occurred up to and including this one.
function muscleSetCount(exercise: Exercise, uptoIndex: number, session: SessionInput): number {
  let count = 0;
  for (let i = 0; i <= uptoIndex; i++) {
    if (session.sets[i]!.exerciseId === exercise.id) count++;
  }
  return count;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
