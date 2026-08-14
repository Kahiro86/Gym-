// Layer 1's public entry point. Layer 2 imports `db` from here; Layer 3
// never imports from this module at all (non-negotiable #3 — the UI talks
// only to Layer 2).
import { createDbClient } from "./client.js";

export const db = createDbClient();

export type {
  Db, Routine, Habit, Entry,
  CreateRoutineInput, UpdateRoutinePatch, CreateHabitInput, UpdateHabitPatch,
  HabitType, TargetDirection, FrequencyType,
} from "./types.js";

export {
  ValidationError, NotFoundError, ConstraintError,
  ConfirmationRequiredError, IllegalStateChangeError,
} from "./errors.js";
