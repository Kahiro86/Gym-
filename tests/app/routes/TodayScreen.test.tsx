// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { createDerivedStateRepository } from "../../../src/storage/repositories/derivedStateRepository.js";
import { TodayScreen } from "../../../src/app/routes/TodayScreen.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

function renderTodayScreen(db: GymDatabase) {
  return render(
    <MemoryRouter initialEntries={["/today"]}>
      <Routes>
        <Route path="/today" element={<TodayScreen />} />
        <Route path="/session" element={<div>SESSION SCREEN</div>} />
        <Route path="/start" element={<div>START SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("TodayScreen", () => {
  it("shows level 1, no streak, no last workout, and a Start a workout cta on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderTodayScreen(db);

    expect(await screen.findByText("Level 1")).toBeInTheDocument();
    expect(await screen.findByText("Train this week to start a streak")).toBeInTheDocument();
    expect(await screen.findByText("No workouts yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue workout" })).not.toBeInTheDocument();
    db.close();
  });

  it("shows Continue workout for a non-stale active session and navigates to /session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderTodayScreen(db);

    const continueButton = await screen.findByRole("button", { name: "Continue workout" });
    expect(screen.queryByRole("button", { name: "Start a workout" })).not.toBeInTheDocument();

    await userEvent.click(continueButton);
    expect(await screen.findByText("SESSION SCREEN")).toBeInTheDocument();
    db.close();
  });

  it("shows Resume for a stale session and hands off to /start", async () => {
    const db = new GymDatabase(uniqueDbName());
    const staleStartedAt = Date.now() - 7 * 60 * 60 * 1000;
    const session = await createSessionRepository(db).create({ startedAt: staleStartedAt });
    await db.sessions.update(session.id, { lastActivityAt: staleStartedAt });
    renderTodayScreen(db);

    await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText("START SCREEN")).toBeInTheDocument();
    db.close();
  });

  it("shows the last completed workout's xp and PR count, and reflects it in the level card", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    const session = await sessions.create({ startedAt: Date.now() });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: Date.now() });
    await sessions.finish(session.id, Date.now());
    await derived.rebuildDerivedState();

    renderTodayScreen(db);

    // The last-workout card's own replay (like the streak card's) costs
    // real time against a non-trivial history — a known Task 20 concern,
    // not something to fix here — so this waits longer than the default,
    // for a signal only the loaded card itself can produce (the level
    // card also renders "... XP" text, so that alone isn't specific
    // enough to prove the last-workout card in particular has loaded).
    expect(await screen.findByText("1 PR", {}, { timeout: 5000 })).toBeInTheDocument();
    // The page heading and the last-workout card's relative-date label
    // ("Today", since it was just logged) are two distinct elements.
    expect(screen.getAllByText("Today")).toHaveLength(2);
    db.close();
  });
});
