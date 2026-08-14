// Thin Layer-1-backed wrappers. These exist so Layer 3 can call the logic
// layer exclusively and never reach past it to the db client directly
// (non-negotiable #3), even for operations that don't need any Layer 2
// computation of their own.
import type { Db, Entry } from "../db/types.js";

export function getEntriesForRange(db: Db, habitId: string, startDate: string, endDate: string): Promise<Entry[]> {
  return db.getEntriesForHabit(habitId, startDate, endDate);
}

// Numeric entry — Layer 1's setEntry already validates the value is a
// real number; nothing else to add here.
export function setEntry(db: Db, habitId: string, date: string, value: number, note?: string | null): Promise<Entry> {
  return db.setEntry(habitId, date, value, note);
}

// Tri-state cycle for boolean habits: no row -> value=1 -> value=0 -> no
// row. Built directly on Layer 1's proven primitives (getEntry/setEntry/
// deleteEntry) — see Layer 1 acceptance test #26 for the state-model
// guarantee this relies on.
export async function toggleEntry(db: Db, habitId: string, date: string): Promise<Entry | null> {
  const current = await db.getEntry(habitId, date);
  if (current === null) return db.setEntry(habitId, date, 1);
  if (current.value === 1) return db.setEntry(habitId, date, 0);
  await db.deleteEntry(habitId, date);
  return null;
}
