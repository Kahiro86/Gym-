// "Did this day count?" — the single definition of completion.
import type { Habit, Entry } from "../db/types.js";

/**
 * No row means unlogged, which is not a completion. An explicit value of
 * 0 means the user recorded a miss — also not a completion, but a
 * genuinely different state that Layer 1 preserves and the UI shows
 * differently (an x, not an empty cell).
 */
export function isCompleted(habit: Habit, entry: Entry | null | undefined): boolean {
  if (!entry) return false;
  if (habit.type === "boolean") return entry.value === 1;
  const target = habit.target ?? 0;
  return habit.targetDirection === "at_most" ? entry.value <= target : entry.value >= target;
}
