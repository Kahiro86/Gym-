// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { createDerivedStateRepository } from "../../../src/storage/repositories/derivedStateRepository.js";
import { ProgressScreen } from "../../../src/app/routes/ProgressScreen.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("ProgressScreen", () => {
  it("defaults to the heatmap tab, with a front/back toggle and a tappable body diagram", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(<ProgressScreen />, { wrapper: withDatabase(db) });

    expect(await screen.findByText("Level 1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Front" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Back" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Tap a muscle to see when it was last trained.")).toBeInTheDocument();
    db.close();
  });

  it("switches to the by-muscle tab and shows level 1 with every muscle group, unranked, on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(<ProgressScreen />, { wrapper: withDatabase(db) });

    await screen.findByText("Level 1");
    await userEvent.click(screen.getByRole("tab", { name: "By muscle" }));

    expect(screen.getByRole("heading", { name: "Chest" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legs" })).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    db.close();
  });

  it("shows a real rank for a muscle that's been trained, in the by-muscle tab", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const derived = createDerivedStateRepository(db);

    const session = await sessions.create({ startedAt: 0 });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sessions.finish(session.id, 100);
    await derived.rebuildDerivedState();

    render(<ProgressScreen />, { wrapper: withDatabase(db) });
    await screen.findByText("Level 1");
    await userEvent.click(screen.getByRole("tab", { name: "By muscle" }));

    // Bench press's share splits across several muscles (chest, delts,
    // triceps) that all land in F range from one set — "F" is expected to
    // match more than once, so this waits for at least one rather than a
    // single element (which "Chest" itself is ambiguous for too: the
    // group heading and chestSternal's own display name are both "Chest").
    await waitFor(() => expect(screen.getAllByText("F").length).toBeGreaterThan(0));
    db.close();
  });

  it("tapping a trained muscle in the heatmap shows its freshness and last-trained day", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    const session = await sessions.create({ startedAt: Date.now() });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: Date.now() });
    await sessions.finish(session.id, Date.now());

    render(<ProgressScreen />, { wrapper: withDatabase(db) });
    await screen.findByText("Level 1");

    // Anchored to the start: "Chest" alone, not "Upper Chest" (a distinct
    // muscle, also trained by bench press and also present on the front
    // view, whose accessible name would otherwise also match unanchored).
    const chest = await screen.findByRole("button", { name: /^Chest: \d+% fresh/ });
    await userEvent.click(chest);

    await waitFor(() => expect(screen.getByText(/% fresh · Today/)).toBeInTheDocument());
    db.close();
  });
});
