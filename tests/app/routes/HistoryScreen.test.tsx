// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { HistoryScreen } from "../../../src/app/routes/HistoryScreen.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

async function loggedSession(db: GymDatabase, startedAt: number) {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const sets = createSetRepository(db);
  const session = await sessions.create({ startedAt });
  const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
  await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: startedAt });
  await sessions.finish(session.id, startedAt + 100);
  return session;
}

describe("HistoryScreen", () => {
  it("shows an empty state on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(<HistoryScreen />, { wrapper: withDatabase(db) });

    expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
    db.close();
  });

  it("lists a completed session with its xp, and doesn't show Load more under a page", async () => {
    const db = new GymDatabase(uniqueDbName());
    await loggedSession(db, Date.now());
    render(<HistoryScreen />, { wrapper: withDatabase(db) });

    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText(/XP/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    db.close();
  });

  it("shows Load more past a full page and reveals older sessions on tap", async () => {
    const db = new GymDatabase(uniqueDbName());
    for (let i = 0; i < 25; i++) {
      await loggedSession(db, i * 1000);
    }
    render(<HistoryScreen />, { wrapper: withDatabase(db) });

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(loadMore);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument());
    db.close();
  });
});
