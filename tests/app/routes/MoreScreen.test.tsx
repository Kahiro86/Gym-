// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { createRoutineRepository } from "../../../src/storage/repositories/routineRepository.js";
import { MoreScreen } from "../../../src/app/routes/MoreScreen.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

function renderMoreScreen(db: GymDatabase) {
  return render(
    <MemoryRouter initialEntries={["/more"]}>
      <ToastProvider>
        <Routes>
          <Route path="/more" element={<MoreScreen />} />
          <Route path="/routines/:id" element={<div>ROUTINE DETAIL</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("MoreScreen", () => {
  it("toggles a preference and persists it", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderMoreScreen(db);

    const toggle = await screen.findByRole("switch", { name: "Auto-start rest timer" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));

    const settings = await db.deviceSettings.get("singleton");
    expect(settings?.restTimerAutoStart).toBe(false);
    db.close();
  });

  it("edits height in the profile section", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderMoreScreen(db);

    const increase = await screen.findByRole("button", { name: "Increase Height" });
    await userEvent.click(increase);

    await waitFor(async () => {
      const profile = await db.profile.get("singleton");
      expect(profile?.heightCm).toBe(171);
    });
    db.close();
  });

  it("creates a routine and navigates to its detail screen", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderMoreScreen(db);

    expect(await screen.findByText("No routines yet")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New routine" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Routine name" }), "Push Day");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("ROUTINE DETAIL")).toBeInTheDocument();
    db.close();
  });

  it("deletes a routine with an undo toast that restores it", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createRoutineRepository(db).create({ name: "Push Day" });
    renderMoreScreen(db);

    expect(await screen.findByText("Push Day")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete Push Day" }));
    await waitFor(() => expect(screen.queryByText("Push Day")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Routine deleted");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Push Day")).toBeInTheDocument();
    db.close();
  });
});
