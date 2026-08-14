// Layer 1 public entry point. Layer 2 and Layer 3 import `db` from here —
// nothing above this ever imports repository.ts, worker.ts, or migrations.ts
// directly, and nothing above this ever writes SQL.
import { createDbClient } from "./client.js";

export const db = createDbClient();
export type { Db, Routine, Habit, Entry, CreateRoutineInput, UpdateRoutinePatch, CreateHabitInput, UpdateHabitPatch, HabitType, TargetDirection, FrequencyType } from "./types.js";
export { ValidationError, NotFoundError, ConstraintError, ConfirmationRequiredError, IllegalStateChangeError } from "./errors.js";
