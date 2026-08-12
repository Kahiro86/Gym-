import { useExercise } from "../hooks/useExercise.js";
import { BODYWEIGHT_PR_SUBJECT } from "../../domain/bodyweight.js";
import { ListRow } from "../ui/ListRow.js";
import type { Pr, PrType } from "../../domain/types.js";

const PR_TYPE_LABEL: Record<PrType, string> = {
  weight: "Weight PR",
  rep: "Rep PR",
  volume: "Volume PR",
  bodyweightMax: "Bodyweight high",
  bodyweightMin: "Bodyweight low",
};

export interface PrRowProps {
  pr: Pr;
}

// One PR line on the session summary (spec §14 task 12). Each row owns its
// own useExercise() call — unlike ExerciseCard's shared useSets(), nothing
// else on this screen needs this data, and a summary only ever lists a
// handful of PRs at once, so there's no sharing problem to solve.
export function PrRow({ pr }: PrRowProps) {
  const isBodyweight = pr.exerciseId === BODYWEIGHT_PR_SUBJECT;
  const { exercise } = useExercise(isBodyweight ? null : pr.exerciseId);
  const name = isBodyweight ? "Bodyweight" : (exercise?.name ?? "…");

  return <ListRow label={name} description={PR_TYPE_LABEL[pr.type]} trailing={`${pr.previousBest} → ${pr.value}`} />;
}
