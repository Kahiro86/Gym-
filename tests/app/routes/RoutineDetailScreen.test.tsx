// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { createRoutineRepository } from "../../../src/storage/repositories/routineRepository.js";
import { RoutineDetailScreen } from "../../../src/app/routes/RoutineDetailScreen.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

function renderAt(db: GymDatabase, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/routines/:id" element={<RoutineDetailScreen />} />
          <Route path="/more" element={<div>MORE SCREEN</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("RoutineDetailScreen", () => {
  it("redirects to /more for a routine that doesn't exist", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderAt(db, "/routines/does-not-exist");
    expect(await screen.findByText("MORE SCREEN")).toBeInTheDocument();
    db.close();
  });

  it("shows the routine name and an empty state with no exercises yet", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    renderAt(db, `/routines/${routine.id}`);

    expect(await screen.findByRole("heading", { name: "Push Day" })).toBeInTheDocument();
    expect(screen.getByText("No exercises yet")).toBeInTheDocument();
    db.close();
  });

  it("adds an exercise, edits its target sets, and removes it with an undo toast", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    renderAt(db, `/routines/${routine.id}`);
    await screen.findByRole("heading", { name: "Push Day" });

    await userEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    await userEvent.click(await screen.findByRole("button", { name: "Barbell Bench Press" }));

    expect(await screen.findByText("Barbell Bench Press")).toBeInTheDocument();
    expect(screen.queryByText("No exercises yet")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Increase Target sets" }));
    await waitFor(async () => {
      const rows = await db.routineExercises.where("routineId").equals(routine.id).toArray();
      expect(rows[0]?.targetSets).toBe(4);
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove Barbell Bench Press" }));
    await waitFor(() => expect(screen.queryByText("Barbell Bench Press")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Exercise removed");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Barbell Bench Press")).toBeInTheDocument();
    db.close();
  });

  it("navigates back to /more via the Back button", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    renderAt(db, `/routines/${routine.id}`);
    await screen.findByRole("heading", { name: "Push Day" });

    await userEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(await screen.findByText("MORE SCREEN")).toBeInTheDocument();
    db.close();
  });
});
