import { describe, it, expect } from "vitest";
import { buildListView, listDays } from "../../src/logic/listView.js";
import type { Routine } from "../../src/db/types.js";
import { makeHabit, makeEntry } from "./factories.js";

const TODAY = "2026-08-14"; // a Friday

function makeRoutine(over: Partial<Routine> = {}): Routine {
  return {
    id: "r1", name: "Morning routine", icon: null, sortOrder: 0,
    archivedAt: null, createdAt: "2026-01-01T12:00:00.000Z", updatedAt: "2026-01-01T12:00:00.000Z",
    ...over,
  };
}

describe("listDays", () => {
  it("returns the requested count, most recent first", () => {
    expect(listDays(TODAY, 5)).toEqual(["2026-08-14", "2026-08-13", "2026-08-12", "2026-08-11", "2026-08-10"]);
  });

  it("walks back across a month boundary", () => {
    expect(listDays("2026-09-02", 4)).toEqual(["2026-09-02", "2026-09-01", "2026-08-31", "2026-08-30"]);
  });
});

describe("buildListView cell states", () => {
  const days = listDays(TODAY, 5);
  const habit = makeHabit({ id: "h1", createdDate: "2026-01-01" });

  const build = (entries: Parameters<typeof buildListView>[2]) =>
    buildListView([], [habit], entries, TODAY, days);

  it("marks a completed boolean day", () => {
    const view = build([makeEntry("2026-08-13", 1, "h1")]);
    expect(view.groups[0].rows[0].cells[1].state).toEqual({ kind: "complete" });
  });

  it("marks an explicitly missed boolean day", () => {
    const view = build([makeEntry("2026-08-13", 0, "h1")]);
    expect(view.groups[0].rows[0].cells[1].state).toEqual({ kind: "missed" });
  });

  it("shows a ring on today when nothing is logged yet", () => {
    expect(build([]).groups[0].rows[0].cells[0].state).toEqual({ kind: "today" });
  });

  it("leaves an unlogged PAST day blank rather than inviting a tap", () => {
    expect(build([]).groups[0].rows[0].cells[1].state).toEqual({ kind: "blank" });
  });

  it("distinguishes an explicit miss from an untouched day", () => {
    const view = build([makeEntry("2026-08-13", 0, "h1")]);
    expect(view.groups[0].rows[0].cells[1].state.kind).toBe("missed");
    expect(view.groups[0].rows[0].cells[2].state.kind).toBe("blank");
  });

  it("shows the raw value for a numeric habit, with its unit", () => {
    const numeric = makeHabit({ id: "h1", type: "numeric", target: 8, unit: "glasses", createdDate: "2026-01-01" });
    const view = buildListView([], [numeric], [makeEntry("2026-08-13", 6, "h1")], TODAY, days);
    // Below target, but the list shows the amount, not a pass/fail mark.
    expect(view.groups[0].rows[0].cells[1].state).toEqual({ kind: "numeric", value: 6, unit: "glasses" });
  });

  it("shows a numeric zero as a value, not as a miss", () => {
    const numeric = makeHabit({ id: "h1", type: "numeric", target: 8, createdDate: "2026-01-01" });
    const view = buildListView([], [numeric], [makeEntry("2026-08-13", 0, "h1")], TODAY, days);
    expect(view.groups[0].rows[0].cells[1].state).toEqual({ kind: "numeric", value: 0, unit: null });
  });
});

describe("buildListView and scheduling", () => {
  const days = listDays(TODAY, 5);

  it("flags days the habit is not due", () => {
    // Mon/Wed/Fri; the window is Fri 14 back to Mon 10.
    const mwf = makeHabit({ id: "h1", frequencyType: "specific_days", frequencyDays: [1, 3, 5], createdDate: "2026-01-01" });
    const cells = buildListView([], [mwf], [], TODAY, days).groups[0].rows[0].cells;
    expect(cells.map((c) => c.scheduled)).toEqual([true, false, true, false, true]);
  });

  it("does not offer today's ring on a day the habit is off", () => {
    // Sundays only; today is a Friday.
    const sundays = makeHabit({ id: "h1", frequencyType: "specific_days", frequencyDays: [0], createdDate: "2026-01-01" });
    const todayCell = buildListView([], [sundays], [], TODAY, days).groups[0].rows[0].cells[0];
    expect(todayCell.scheduled).toBe(false);
    expect(todayCell.state).toEqual({ kind: "blank" });
  });

  it("treats every day as schedulable for a times_per_week habit", () => {
    const tpw = makeHabit({ id: "h1", frequencyType: "times_per_week", frequencyCount: 3, createdDate: "2026-01-01" });
    const cells = buildListView([], [tpw], [], TODAY, days).groups[0].rows[0].cells;
    expect(cells.every((c) => c.scheduled)).toBe(true);
  });
});

describe("buildListView grouping", () => {
  const days = listDays(TODAY, 5);

  it("nests habits under their routine, with loose habits in a final group", () => {
    const routine = makeRoutine({ id: "r1", name: "Morning" });
    const inRoutine = makeHabit({ id: "h1", name: "Pray", routineId: "r1" });
    const loose = makeHabit({ id: "h2", name: "Read" });
    const view = buildListView([routine], [inRoutine, loose], [], TODAY, days);

    expect(view.groups).toHaveLength(2);
    expect(view.groups[0].routine?.name).toBe("Morning");
    expect(view.groups[0].rows.map((r) => r.habit.name)).toEqual(["Pray"]);
    expect(view.groups[1].routine).toBeNull();
    expect(view.groups[1].rows.map((r) => r.habit.name)).toEqual(["Read"]);
  });

  it("drops a routine that has no habits rather than showing an empty header", () => {
    const view = buildListView([makeRoutine({ id: "r-empty" })], [makeHabit({ id: "h1" })], [], TODAY, days);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].routine).toBeNull();
  });

  it("omits the loose group entirely when every habit has a routine", () => {
    const routine = makeRoutine({ id: "r1" });
    const view = buildListView([routine], [makeHabit({ id: "h1", routineId: "r1" })], [], TODAY, days);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].routine?.id).toBe("r1");
  });

  it("returns no groups at all for a user with no habits", () => {
    expect(buildListView([], [], [], TODAY, days).groups).toEqual([]);
  });

  it("keeps routines in the order given", () => {
    const a = makeRoutine({ id: "r1", name: "First", sortOrder: 0 });
    const b = makeRoutine({ id: "r2", name: "Second", sortOrder: 1 });
    const view = buildListView([a, b], [
      makeHabit({ id: "h1", routineId: "r2" }),
      makeHabit({ id: "h2", routineId: "r1" }),
    ], [], TODAY, days);
    expect(view.groups.map((g) => g.routine?.name)).toEqual(["First", "Second"]);
  });

  it("keeps one habit's entries out of another's cells", () => {
    const h1 = makeHabit({ id: "h1", name: "One" });
    const h2 = makeHabit({ id: "h2", name: "Two" });
    const view = buildListView([], [h1, h2], [makeEntry("2026-08-14", 1, "h1")], TODAY, days);
    expect(view.groups[0].rows[0].cells[0].state).toEqual({ kind: "complete" });
    expect(view.groups[0].rows[1].cells[0].state).toEqual({ kind: "today" });
  });

  it("aligns every row's cells with the view's day columns", () => {
    const view = buildListView([], [makeHabit({ id: "h1" })], [], TODAY, days);
    expect(view.groups[0].rows[0].cells.map((c) => c.date)).toEqual(view.days);
  });
});

describe("list filters", () => {
  const days = listDays(TODAY, 5);
  const names = (v: ReturnType<typeof buildListView>) => v.groups.flatMap((g) => g.rows.map((r) => r.habit.name));

  it("shows everything when no filter is set", () => {
    const habits = [
      makeHabit({ id: "a", name: "Done" }),
      makeHabit({ id: "b", name: "Not done" }),
    ];
    const view = buildListView([], habits, [makeEntry(TODAY, 1, "a")], TODAY, days);
    expect(names(view)).toEqual(["Done", "Not done"]);
  });

  it("hideCompletedToday drops a habit completed today", () => {
    // The case that silently did nothing: the lookup key was built with
    // a space where the rest of the file uses a NUL separator, so the
    // entry was never found and every habit looked outstanding.
    const habits = [
      makeHabit({ id: "a", name: "Done" }),
      makeHabit({ id: "b", name: "Not done" }),
    ];
    const view = buildListView([], habits, [makeEntry(TODAY, 1, "a")], TODAY, days, { hideCompletedToday: true });
    expect(names(view)).toEqual(["Not done"]);
  });

  it("hideCompletedToday keeps a habit explicitly marked as missed", () => {
    // A recorded miss is not a completion — the day is still outstanding.
    const habits = [makeHabit({ id: "a", name: "Missed" })];
    const view = buildListView([], habits, [makeEntry(TODAY, 0, "a")], TODAY, days, { hideCompletedToday: true });
    expect(names(view)).toEqual(["Missed"]);
  });

  it("hideCompletedToday ignores a completion on an earlier day", () => {
    const habits = [makeHabit({ id: "a", name: "Yesterday only" })];
    const view = buildListView([], habits, [makeEntry("2026-08-13", 1, "a")], TODAY, days, { hideCompletedToday: true });
    expect(names(view)).toEqual(["Yesterday only"]);
  });

  it("hideCompletedToday judges a numeric habit against its target", () => {
    const habits = [
      makeHabit({ id: "a", name: "Under", type: "numeric", target: 2, unit: "L" }),
      makeHabit({ id: "b", name: "Over", type: "numeric", target: 2, unit: "L" }),
    ];
    const view = buildListView(
      [], habits, [makeEntry(TODAY, 1, "a"), makeEntry(TODAY, 3, "b")], TODAY, days,
      { hideCompletedToday: true },
    );
    expect(names(view)).toEqual(["Under"]);
  });

  it("hideCompletedToday respects an at_most target", () => {
    // "No more than one coffee": one is a success, so it drops out.
    const habits = [
      makeHabit({ id: "a", name: "Within", type: "numeric", target: 1, targetDirection: "at_most" }),
      makeHabit({ id: "b", name: "Over", type: "numeric", target: 1, targetDirection: "at_most" }),
    ];
    const view = buildListView(
      [], habits, [makeEntry(TODAY, 1, "a"), makeEntry(TODAY, 4, "b")], TODAY, days,
      { hideCompletedToday: true },
    );
    expect(names(view)).toEqual(["Over"]);
  });

  it("drops a group the filter empties, rather than leaving a bare heading", () => {
    const routine = makeRoutine({ id: "r" });
    const habits = [makeHabit({ id: "a", name: "Only one", routineId: "r" })];
    const view = buildListView([routine], habits, [makeEntry(TODAY, 1, "a")], TODAY, days, { hideCompletedToday: true });
    expect(view.groups).toEqual([]);
  });
});
