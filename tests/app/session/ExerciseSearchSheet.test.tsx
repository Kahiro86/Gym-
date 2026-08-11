// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { ExerciseSearchSheet } from "../../../src/app/session/ExerciseSearchSheet.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("ExerciseSearchSheet", () => {
  it("renders nothing when closed", () => {
    const db = new GymDatabase(uniqueDbName());
    render(<ExerciseSearchSheet open={false} title="Add exercise" onClose={() => {}} onPick={() => {}} />, {
      wrapper: withDatabase(db),
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    db.close();
  });

  it("shows no results until the user types something", () => {
    const db = new GymDatabase(uniqueDbName());
    render(<ExerciseSearchSheet open title="Add exercise" onClose={() => {}} onPick={() => {}} />, {
      wrapper: withDatabase(db),
    });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    db.close();
  });

  it("shows an empty state for a query with no matches", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(<ExerciseSearchSheet open title="Add exercise" onClose={() => {}} onPick={() => {}} />, {
      wrapper: withDatabase(db),
    });
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "zzzznonexistent");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    db.close();
  });

  it("calls onPick with the chosen exercise's id, title reflects the caller's mode", async () => {
    const db = new GymDatabase(uniqueDbName());
    const onPick = vi.fn();
    render(<ExerciseSearchSheet open title="Swap exercise" onClose={() => {}} onPick={onPick} />, {
      wrapper: withDatabase(db),
    });

    expect(screen.getByRole("dialog", { name: "Swap exercise" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    await userEvent.click(await screen.findByRole("button", { name: "Barbell Bench Press" }));

    expect(onPick).toHaveBeenCalledWith("barbell-bench-press");
    db.close();
  });

  it("clears the search query after being closed and reopened, since the Sheet never unmounts it", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { rerender } = render(<ExerciseSearchSheet open title="Add exercise" onClose={() => {}} onPick={() => {}} />, {
      wrapper: withDatabase(db),
    });
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    expect(screen.getByRole("textbox", { name: "Search exercises" })).toHaveValue("bench press");

    rerender(<ExerciseSearchSheet open={false} title="Add exercise" onClose={() => {}} onPick={() => {}} />);
    rerender(<ExerciseSearchSheet open title="Swap exercise" onClose={() => {}} onPick={() => {}} />);

    expect(screen.getByRole("textbox", { name: "Search exercises" })).toHaveValue("");
    db.close();
  });
});
