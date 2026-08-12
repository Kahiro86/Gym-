// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { ActiveSessionScreen } from "../../../src/app/routes/ActiveSessionScreen.js";
import { SessionSummaryScreen } from "../../../src/app/routes/SessionSummaryScreen.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

function renderAt(db: GymDatabase, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/session" element={<ActiveSessionScreen />} />
          <Route path="/session/summary" element={<SessionSummaryScreen />} />
          <Route path="/start" element={<div>START SCREEN</div>} />
          <Route path="/today" element={<div>TODAY SCREEN</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("ActiveSessionScreen", () => {
  it("renders once there is an active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    expect(await screen.findByRole("heading", { name: "Session in progress" })).toBeInTheDocument();
    db.close();
  });

  it("redirects to /start when there is no active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderAt(db, "/session");

    expect(await screen.findByText("START SCREEN")).toBeInTheDocument();
    db.close();
  });

  it("shows an empty state with no exercises yet", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    expect(await screen.findByText("No exercises yet")).toBeInTheDocument();
    db.close();
  });

  it("adds an exercise via the search sheet, logs a set, and shows it in the exercise's set list", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    await userEvent.click(await screen.findByRole("button", { name: "Add exercise" }));
    expect(await screen.findByRole("dialog", { name: "Add exercise" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    await userEvent.click(await screen.findByRole("button", { name: "Barbell Bench Press" }));

    expect(await screen.findByRole("heading", { name: "Barbell Bench Press" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("First time logging this exercise")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByText("20 kg × 8")).toBeInTheDocument()); // defaults
    db.close();
  });

  it("swaps an exercise for a different one via the search sheet, keeping the same slot's logged sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    await userEvent.click(await screen.findByRole("button", { name: "Add exercise" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    await userEvent.click(await screen.findByRole("button", { name: "Barbell Bench Press" }));
    await screen.findByRole("heading", { name: "Barbell Bench Press" });
    await userEvent.click(await screen.findByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByText("20 kg × 8")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Swap" }));
    expect(await screen.findByRole("dialog", { name: "Swap exercise" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "back squat");
    await userEvent.click(await screen.findByRole("button", { name: "Back Squat" }));

    expect(await screen.findByRole("heading", { name: "Back Squat" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Barbell Bench Press" })).not.toBeInTheDocument();
    // The set logged before the swap is still there, under the same slot.
    expect(screen.getByText("20 kg × 8")).toBeInTheDocument();
    db.close();
  });

  it("skips an exercise, removing it with an undo toast that restores it", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    await userEvent.click(await screen.findByRole("button", { name: "Add exercise" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    await userEvent.click(await screen.findByRole("button", { name: "Barbell Bench Press" }));
    await screen.findByRole("heading", { name: "Barbell Bench Press" });

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Barbell Bench Press" })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Exercise removed");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "Barbell Bench Press" })).toBeInTheDocument();
    db.close();
  });

  it("Finish workout completes the session and navigates to /today", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    await userEvent.click(await screen.findByRole("button", { name: "Finish workout" }));
    expect(await screen.findByText("TODAY SCREEN")).toBeInTheDocument();

    const completed = await db.sessions.where("state").equals("completed").count();
    const discarded = await db.sessions.where("state").equals("discarded").count();
    expect(completed + discarded).toBe(1); // no sets logged -> discarded, not completed
    db.close();
  });

  it("Finish workout with a logged set completes the session and shows the summary screen", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    await userEvent.click(await screen.findByRole("button", { name: "Add exercise" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search exercises" }), "bench press");
    await userEvent.click(await screen.findByRole("button", { name: "Barbell Bench Press" }));
    await screen.findByRole("heading", { name: "Barbell Bench Press" });
    await userEvent.click(await screen.findByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByText("20 kg × 8")).toBeInTheDocument());

    await userEvent.click(await screen.findByRole("button", { name: "Finish workout" }));

    expect(await screen.findByRole("heading", { name: "Workout complete" })).toBeInTheDocument();
    expect(screen.getAllByText(/XP$/).length).toBeGreaterThan(0);
    expect(screen.queryByText("TODAY SCREEN")).not.toBeInTheDocument();

    const completed = await db.sessions.where("state").equals("completed").count();
    expect(completed).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("TODAY SCREEN")).toBeInTheDocument();
    db.close();
  });
});
