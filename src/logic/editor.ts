// Layer 2's write surface for habits and routines.
//
// The build spec describes three read screens and no way to create a
// habit, so the top bar's "+" had nothing behind it and the app could
// only ever be empty. This is the logic half of closing that: the form's
// draft shape, the rules for turning a draft into something Layer 1 will
// accept, and the passthroughs the editor screen calls.
//
// The validation here is NOT a second copy of Layer 1's. Layer 1 remains
// the authority and still rejects a bad habit outright; this exists so
// the form can grey out Save and say which field is wrong before a write
// is attempted, rather than surfacing a thrown error after the fact.
import type {
  CreateHabitInput, Db, FrequencyType, Habit, HabitType, Routine, TargetDirection,
} from "../db/types.js";

/**
 * What the form holds while it is being filled in. Every field is a
 * string because that is what an input yields; conversion happens once,
 * in `toCreateInput`, so there is one place where "" becomes null and
 * "3" becomes 3.
 */
export interface HabitDraft {
  name: string;
  question: string;
  type: HabitType;
  unit: string;
  target: string;
  targetDirection: TargetDirection;
  frequencyType: FrequencyType;
  /** 0-6, Sun-Sat. Only meaningful for "specific_days". */
  frequencyDays: number[];
  frequencyCount: string;
  routineId: string | null;
  reminderTime: string;
}

export function emptyDraft(type: HabitType): HabitDraft {
  return {
    name: "",
    question: "",
    type,
    unit: "",
    target: "",
    targetDirection: "at_least",
    // Daily is the only frequency that needs no further choice, so it is
    // the one that lets someone finish the form immediately.
    frequencyType: "daily",
    frequencyDays: [1, 2, 3, 4, 5],
    frequencyCount: "3",
    routineId: null,
    reminderTime: "",
  };
}

/** Loads an existing habit back into the form's shape. */
export function draftFromHabit(habit: Habit): HabitDraft {
  return {
    name: habit.name,
    question: habit.question ?? "",
    type: habit.type,
    unit: habit.unit ?? "",
    target: habit.target == null ? "" : String(habit.target),
    targetDirection: habit.targetDirection,
    frequencyType: habit.frequencyType,
    frequencyDays: habit.frequencyDays ?? [1, 2, 3, 4, 5],
    frequencyCount: habit.frequencyCount == null ? "3" : String(habit.frequencyCount),
    routineId: habit.routineId,
    reminderTime: habit.reminderTime ?? "",
  };
}

export interface DraftProblem {
  field: keyof HabitDraft;
  message: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Everything wrong with the draft, all of it at once. Returning the full
 * list rather than the first problem means the form can mark every bad
 * field instead of revealing them one at a time.
 */
export function validateDraft(draft: HabitDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (!draft.name.trim()) {
    problems.push({ field: "name", message: "A habit needs a name." });
  }

  if (draft.type === "numeric") {
    const target = Number(draft.target);
    if (!draft.target.trim()) {
      problems.push({ field: "target", message: "A measurable habit needs a target." });
    } else if (!Number.isFinite(target)) {
      problems.push({ field: "target", message: "The target must be a number." });
    } else if (target <= 0) {
      problems.push({ field: "target", message: "The target must be greater than zero." });
    }
  }

  if (draft.frequencyType === "specific_days" && draft.frequencyDays.length === 0) {
    problems.push({ field: "frequencyDays", message: "Pick at least one day." });
  }

  if (draft.frequencyType === "times_per_week" || draft.frequencyType === "times_per_month") {
    const count = Number(draft.frequencyCount);
    const max = draft.frequencyType === "times_per_week" ? 7 : 31;
    if (!Number.isInteger(count) || count < 1) {
      problems.push({ field: "frequencyCount", message: "How many times? At least one." });
    } else if (count > max) {
      problems.push({
        field: "frequencyCount",
        message: `A ${draft.frequencyType === "times_per_week" ? "week" : "month"} has only ${max} days.`,
      });
    }
  }

  if (draft.reminderTime.trim() && !TIME_RE.test(draft.reminderTime.trim())) {
    problems.push({ field: "reminderTime", message: "Use a 24-hour time like 07:30." });
  }

  return problems;
}

/**
 * Turns a valid draft into Layer 1's input shape.
 *
 * The fields that do not apply are sent as null rather than left off:
 * Layer 1 refuses a boolean habit that carries a target, and an edit that
 * switches from measurable to yes/no has to actively clear it. Omitting
 * the key would leave the old value in place.
 */
export function toCreateInput(draft: HabitDraft): CreateHabitInput {
  const numeric = draft.type === "numeric";
  const specificDays = draft.frequencyType === "specific_days";
  const timesPer = draft.frequencyType === "times_per_week" || draft.frequencyType === "times_per_month";
  return {
    name: draft.name.trim(),
    question: draft.question.trim() || null,
    type: draft.type,
    unit: numeric ? draft.unit.trim() || null : null,
    target: numeric ? Number(draft.target) : null,
    targetDirection: draft.targetDirection,
    frequencyType: draft.frequencyType,
    frequencyDays: specificDays ? [...draft.frequencyDays].sort((a, b) => a - b) : null,
    frequencyCount: timesPer ? Number(draft.frequencyCount) : null,
    routineId: draft.routineId,
    reminderTime: draft.reminderTime.trim() || null,
  };
}

// ── Passthroughs ──────────────────────────────────────────────────────
// Thin by design. They exist so Layer 3 imports from Layer 2 only, and
// so a rule that later needs to apply to every write has one place to go.

export async function createHabit(db: Db, draft: HabitDraft): Promise<Habit> {
  return db.createHabit(toCreateInput(draft));
}

export async function updateHabit(db: Db, habitId: string, draft: HabitDraft): Promise<Habit> {
  return db.updateHabit(habitId, toCreateInput(draft));
}

export function archiveHabit(db: Db, habitId: string): Promise<void> {
  return db.archiveHabit(habitId);
}

export function unarchiveHabit(db: Db, habitId: string): Promise<void> {
  return db.unarchiveHabit(habitId);
}

/** Permanent and cascades. The flag is Layer 1's, not decoration. */
export function deleteHabit(db: Db, habitId: string): Promise<void> {
  return db.deleteHabit(habitId, { confirmed: true });
}

/** Removes a logged day. Distinct from recording an explicit miss. */
export function deleteEntry(db: Db, habitId: string, date: string): Promise<void> {
  return db.deleteEntry(habitId, date);
}

export function listRoutines(db: Db): Promise<Routine[]> {
  return db.listRoutines();
}

export function createRoutine(db: Db, name: string): Promise<Routine> {
  return db.createRoutine({ name: name.trim() });
}

/** Whether a habit's type can still be changed — Layer 1 §6.3. */
export async function canChangeType(db: Db, habitId: string): Promise<boolean> {
  return (await db.getEntryCount(habitId)) === 0;
}
