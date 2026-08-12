// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { createDerivedStateRepository } from "../../../src/storage/repositories/derivedStateRepository.js";
import { ProgressScreen } from "../../../src/app/routes/ProgressScreen.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("ProgressScreen", () => {
  it("shows level 1 and every muscle group, unranked, on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(<ProgressScreen />, { wrapper: withDatabase(db) });

    expect(await screen.findByText("Level 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chest" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legs" })).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    db.close();
  });

  it("shows a real rank for a muscle that's been trained", async () => {
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

    // Bench press's share splits across several muscles (chest, delts,
    // triceps) that all land in F range from one set — "F" is expected to
    // match more than once, so this waits for at least one rather than a
    // single element (which "Chest" itself is ambiguous for too: the
    // group heading and chestSternal's own display name are both "Chest").
    await waitFor(() => expect(screen.getAllByText("F").length).toBeGreaterThan(0));
    db.close();
  });
});
