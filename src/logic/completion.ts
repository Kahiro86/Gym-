// "Did this day count?" — the single definition of completion.
import type { Habit, Entry } from "../db/types.js";

/**
 * No row means unlogged, which is not a completion. An explicit value of
 * 0 means the user recorded a miss — also not a completion, but a
 * genuinely different state that Layer 1 preserves and the UI shows
 * differently (an x, not an empty cell).
 */
/**
 * Whether "explicitly missed" is a state this habit can be in — Layer 2b §3.
 *
 * For an `at_most` habit it is not. The tri-state model reads `value = 0`
 * as a recorded miss, but for "no more than 30 minutes of scrolling" a
 * logged zero is the BEST possible outcome, not a failure. You cannot
 * fail to not smoke. So for these habits 0 is a completion, and the
 * explicit-miss state is disallowed rather than left to be discovered:
 * the only way to say "I did not log this" is to have no row.
 */
export function allowsExplicitMiss(habit: Habit): boolean {
  return !(habit.type === "numeric" && habit.targetDirection === "at_most");
}

export function isCompleted(habit: Habit, entry: Entry | null | undefined): boolean {
  if (!entry) return false;
  if (habit.type === "boolean") return entry.value === 1;
  const target = habit.target ?? 0;
  return habit.targetDirection === "at_most" ? entry.value <= target : entry.value >= target;
}
