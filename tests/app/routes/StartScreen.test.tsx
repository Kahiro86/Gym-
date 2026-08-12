// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { StartScreen } from "../../../src/app/routes/StartScreen.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

function renderStartScreen(db: GymDatabase) {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <ToastProvider>
        <Routes>
          <Route path="/start" element={<StartScreen />} />
          <Route path="/session" element={<div>SESSION SCREEN</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("StartScreen", () => {
  it("shows Start Workout and opens the start sheet when tapped, with no active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderStartScreen(db);

    const startButton = await screen.findByRole("button", { name: "Start Workout" });
    await userEvent.click(startButton);
    expect(await screen.findByRole("dialog", { name: "Start a workout" })).toBeInTheDocument();
    db.close();
  });

  it("shows Continue workout for a non-stale active session and navigates to /session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderStartScreen(db);

    const continueButton = await screen.findByRole("button", { name: "Continue workout" });
    await userEvent.click(continueButton);
    expect(await screen.findByText("SESSION SCREEN")).toBeInTheDocument();
    db.close();
  });

  it("shows Resume/Discard for a stale session, and Discard clears it back to Start Workout", async () => {
    const db = new GymDatabase(uniqueDbName());
    const staleStartedAt = Date.now() - 7 * 60 * 60 * 1000;
    const session = await createSessionRepository(db).create({ startedAt: staleStartedAt });
    await db.sessions.update(session.id, { lastActivityAt: staleStartedAt });
    renderStartScreen(db);

    await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start Workout" })).toBeInTheDocument());
    db.close();
  });
});
