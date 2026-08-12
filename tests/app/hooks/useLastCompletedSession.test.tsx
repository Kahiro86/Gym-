// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { useLastCompletedSession } from "../../../src/app/hooks/useLastCompletedSession.js";
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

describe("useLastCompletedSession", () => {
  it("is null on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useLastCompletedSession(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lastSession).toBeNull();
    db.close();
  });

  it("finds the most recently started completed session and its xp", async () => {
    const db = new GymDatabase(uniqueDbName());
    await loggedSession(db, 0);
    const latest = await loggedSession(db, 10_000);

    const { result } = renderHook(() => useLastCompletedSession(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lastSession?.session.id).toBe(latest.id);
    expect(result.current.lastSession?.xp.total).toBeGreaterThan(0);
    db.close();
  });

  it("skips an in-progress session to find the last completed one", async () => {
    const db = new GymDatabase(uniqueDbName());
    const completed = await loggedSession(db, 0);
    // A newer session that never finished shouldn't be reported as "last".
    await createSessionRepository(db).create({ startedAt: 20_000 });

    const { result } = renderHook(() => useLastCompletedSession(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lastSession?.session.id).toBe(completed.id);
    db.close();
  });
});
