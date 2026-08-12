import { musclesInGroup } from "../../domain/muscles.js";
import { rankForMuscleXp } from "../../domain/progression.js";
import { RankBadge } from "./RankBadge.js";
import styles from "./MuscleGroupSection.module.css";
import type { Group, MuscleId } from "../../domain/muscles.js";

export interface MuscleGroupSectionProps {
  group: Group;
  muscleXp: Record<MuscleId, number>;
}

// One body-region section of the Progress tab's per-muscle breakdown
// (spec §14 task 15) — every muscle in the group, its lifetime XP, and its
// rank (Layer 1's rankForMuscleXp curve, called directly per the "Layer 3
// calls Layer 1 for anything derived" rule — never reimplemented here).
export function MuscleGroupSection({ group, muscleXp }: MuscleGroupSectionProps) {
  const muscles = musclesInGroup(group.id);

  return (
    <section>
      <h2 className={styles.heading}>{group.displayName}</h2>
      <ul className={styles.list}>
        {muscles.map((muscle) => {
          const xp = muscleXp[muscle.id];
          return (
            <li key={muscle.id} className={styles.row}>
              <span className={styles.name}>{muscle.displayName}</span>
              <span className={styles.xp}>{Math.round(xp)} XP</span>
              <RankBadge rank={rankForMuscleXp(xp)} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
