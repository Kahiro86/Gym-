import { describe, expect, it } from "vitest";
import {
  emptyDraft, draftFromHabit, validateDraft, toCreateInput,
} from "../../src/logic/editor.js";
import type { HabitDraft } from "../../src/logic/editor.js";
import type { Habit } from "../../src/db/types.js";

const draft = (over: Partial<HabitDraft> = {}): HabitDraft => ({ ...emptyDraft("boolean"), name: "Read", ...over });
const fields = (d: HabitDraft) => validateDraft(d).map((p) => p.field);

describe("emptyDraft", () => {
  it("starts on daily, the one frequency that needs no further choice", () => {
    expect(emptyDraft("boolean").frequencyType).toBe("daily");
  });

  it("is invalid only because it has no name yet", () => {
    expect(fields(emptyDraft("boolean"))).toEqual(["name"]);
  });

  it("a measurable draft also needs a target before it can be saved", () => {
    expect(fields(emptyDraft("numeric")).sort()).toEqual(["name", "target"]);
  });
});

describe("validateDraft", () => {
  it("accepts the simplest possible habit", () => {
    expect(validateDraft(draft())).toEqual([]);
  });

  it("rejects a name that is only whitespace", () => {
    expect(fields(draft({ name: "   " }))).toEqual(["name"]);
  });

  it("reports every problem at once, not just the first", () => {
    const bad = draft({ name: "", type: "numeric", target: "", reminderTime: "25:00" });
    expect(fields(bad).sort()).toEqual(["name", "reminderTime", "target"]);
  });

  it("rejects a target that is not a number", () => {
    expect(fields(draft({ type: "numeric", target: "lots" }))).toEqual(["target"]);
  });

  it("rejects a target of zero — nothing would ever count as done", () => {
    expect(fields(draft({ type: "numeric", target: "0" }))).toEqual(["target"]);
  });

  it("accepts a fractional target", () => {
    expect(validateDraft(draft({ type: "numeric", target: "1.5", unit: "L" }))).toEqual([]);
  });

  it("ignores the target on a yes/no habit even if one is left behind", () => {
    // Switching type in the form leaves the old text in the input; it
    // must not block saving, and toCreateInput drops it.
    expect(validateDraft(draft({ type: "boolean", target: "9" }))).toEqual([]);
  });

  it("requires at least one day when specific days are chosen", () => {
    expect(fields(draft({ frequencyType: "specific_days", frequencyDays: [] }))).toEqual(["frequencyDays"]);
  });

  it("refuses more than seven times a week", () => {
    expect(fields(draft({ frequencyType: "times_per_week", frequencyCount: "8" }))).toEqual(["frequencyCount"]);
  });

  it("allows exactly seven times a week", () => {
    expect(validateDraft(draft({ frequencyType: "times_per_week", frequencyCount: "7" }))).toEqual([]);
  });

  it("refuses more than thirty-one times a month", () => {
    expect(fields(draft({ frequencyType: "times_per_month", frequencyCount: "32" }))).toEqual(["frequencyCount"]);
  });

  it("refuses a fractional count", () => {
    expect(fields(draft({ frequencyType: "times_per_week", frequencyCount: "2.5" }))).toEqual(["frequencyCount"]);
  });

  it("treats an empty reminder as no reminder, not a bad one", () => {
    expect(validateDraft(draft({ reminderTime: "   " }))).toEqual([]);
  });

  it("rejects a malformed reminder time", () => {
    for (const bad of ["7:30", "24:00", "07:60", "0730", "morning"]) {
      expect(fields(draft({ reminderTime: bad })), bad).toEqual(["reminderTime"]);
    }
  });

  it("accepts a well-formed reminder time", () => {
    for (const ok of ["00:00", "07:30", "23:59"]) {
      expect(validateDraft(draft({ reminderTime: ok })), ok).toEqual([]);
    }
  });
});

describe("toCreateInput", () => {
  it("trims the name and turns a blank question into null", () => {
    const input = toCreateInput(draft({ name: "  Read  ", question: "   " }));
    expect(input.name).toBe("Read");
    expect(input.question).toBeNull();
  });

  it("clears target and unit on a yes/no habit, so an edit can switch back", () => {
    // Layer 1 refuses a boolean habit carrying a target. Omitting the
    // keys instead of nulling them would leave the old values in place.
    const input = toCreateInput(draft({ type: "boolean", target: "9", unit: "km" }));
    expect(input.target).toBeNull();
    expect(input.unit).toBeNull();
  });

  it("carries target and unit on a measurable habit", () => {
    const input = toCreateInput(draft({ type: "numeric", target: "2", unit: " L " }));
    expect(input.target).toBe(2);
    expect(input.unit).toBe("L");
  });

  it("sorts the chosen days, so the stored order does not depend on tap order", () => {
    const input = toCreateInput(draft({ frequencyType: "specific_days", frequencyDays: [5, 1, 3] }));
    expect(input.frequencyDays).toEqual([1, 3, 5]);
  });

  it("nulls frequencyDays unless the frequency actually uses them", () => {
    expect(toCreateInput(draft({ frequencyType: "daily", frequencyDays: [1, 2] })).frequencyDays).toBeNull();
  });

  it("nulls frequencyCount unless the frequency actually uses it", () => {
    expect(toCreateInput(draft({ frequencyType: "daily", frequencyCount: "3" })).frequencyCount).toBeNull();
  });

  it("carries frequencyCount for times-per-week", () => {
    expect(toCreateInput(draft({ frequencyType: "times_per_week", frequencyCount: "4" })).frequencyCount).toBe(4);
  });
});

describe("draftFromHabit", () => {
  const habit: Habit = {
    id: "h1", name: "Water", icon: null, question: "Enough water?",
    type: "numeric", unit: "L", target: 2, targetDirection: "at_least",
    frequencyType: "specific_days", frequencyDays: [1, 3, 5], frequencyCount: null,
    routineId: "r1", sortOrder: 0, color: null, reminderTime: "07:30",
    archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("round-trips a habit through the form without changing it", () => {
    const input = toCreateInput(draftFromHabit(habit));
    expect(input).toMatchObject({
      name: "Water", question: "Enough water?", type: "numeric", unit: "L", target: 2,
      targetDirection: "at_least", frequencyType: "specific_days", frequencyDays: [1, 3, 5],
      frequencyCount: null, routineId: "r1", reminderTime: "07:30",
    });
  });

  it("an unedited habit loaded into the form is valid", () => {
    expect(validateDraft(draftFromHabit(habit))).toEqual([]);
  });

  it("shows empty strings, not the word null, for absent optional fields", () => {
    const bare = draftFromHabit({ ...habit, question: null, unit: null, target: null, type: "boolean", reminderTime: null });
    expect(bare.question).toBe("");
    expect(bare.unit).toBe("");
    expect(bare.target).toBe("");
    expect(bare.reminderTime).toBe("");
  });
});
