// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { AddExerciseField } from "../../../src/app/session/AddExerciseField.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("AddExerciseField", () => {
  it("shows no results list until the user types something", () => {
    const db = new GymDatabase(uniqueDbName());
    render(<AddExerciseField onAdd={() => {}} />, { wrapper: withDatabase(db) });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    db.close();
  });

  it("searches as the user types and calls onAdd with the picked exercise, then clears", async () => {
    const db = new GymDatabase(uniqueDbName());
    const onAdd = vi.fn();
    render(<AddExerciseField onAdd={onAdd} />, { wrapper: withDatabase(db) });

    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    const result = await screen.findByRole("button", { name: "Barbell Bench Press" });
    await userEvent.click(result);

    expect(onAdd).toHaveBeenCalledWith("barbell-bench-press");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search exercises" })).toHaveValue(""));
    db.close();
  });
});
