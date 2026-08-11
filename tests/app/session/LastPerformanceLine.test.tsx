// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { LastPerformanceLine } from "../../../src/app/session/LastPerformanceLine.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("LastPerformanceLine", () => {
  it("shows a first-time message when the exercise has no history", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(<LastPerformanceLine exerciseId={BENCH} />, { wrapper: withDatabase(db) });
    await waitFor(() => expect(screen.getByText("First time logging this exercise")).toBeInTheDocument());
    db.close();
  });

  it("summarizes the most recent session's sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    const session = await sessions.create({ startedAt: 1000 });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await sets.log({ sessionExerciseId: se.id, weightKg: 62.5, reps: 4, bodyweightKgAtTime: 80, loggedAt: 2000 });

    render(<LastPerformanceLine exerciseId={BENCH} />, { wrapper: withDatabase(db) });
    await waitFor(() => expect(screen.getByText("60 kg × 5, 62.5 kg × 4")).toBeInTheDocument());
    db.close();
  });
});
