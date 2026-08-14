// "Did this day count as completed?" — the single definition of
// completion, reused by score/streak/history/heatmap alike.
import type { Habit, Entry } from "../db/types.js";

export function isCompleted(habit: Habit, entry: Entry | null): boolean {
  if (!entry) return false;
  if (habit.type === "boolean") return entry.value === 1;
  // numeric
  const target = habit.target ?? 0;
  return habit.targetDirection === "at_most" ? entry.value <= target : entry.value >= target;
}
