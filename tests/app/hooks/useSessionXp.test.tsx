// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { useSessionXp } from "../../../src/app/hooks/useSessionXp.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("useSessionXp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reflects the session's currently logged sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    const session = await createSessionRepository(db).create({ startedAt: 0 });
    const se = await createSessionExerciseRepository(db).add({ sessionId: session.id, exerciseId: BENCH });
    await createSetRepository(db).log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });

    const { result } = renderHook(() => useSessionXp(session.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.xp?.total).toBeGreaterThan(0);
    db.close();
  });

  it("only replays this session's prior history once, reusing it across repeated refresh() calls (spec §14 task 20)", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    // A session before the one under test, so getHistoryContextForSession
    // actually has something to replay through rather than a trivial
    // empty-database case.
    const earlier = await sessions.create({ startedAt: 0 });
    const earlierSe = await sessionExercises.add({ sessionId: earlier.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: earlierSe.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 0 });
    await sessions.finish(earlier.id, 100);

    const session = await sessions.create({ startedAt: 1000 });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });

    // replaySessions() (inside getHistoryContextForSession) reads the
    // full sessions table exactly once per call, and nothing else this
    // hook touches (sessionExercises/sets repositories) does — a
    // distinguishing signal for "a full historical replay happened."
    const replaySpy = vi.spyOn(db.sessions, "toArray");

    const { result } = renderHook(() => useSessionXp(session.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(replaySpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await sets.log({ sessionExerciseId: se.id, weightKg: 62.5, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await result.current.refresh();
    });
    await act(async () => {
      await sets.log({ sessionExerciseId: se.id, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 2000 });
      await result.current.refresh();
    });

    // Three refresh() calls total (the initial mount + two explicit
    // calls), but the expensive replay only ran for the first one.
    expect(replaySpy).toHaveBeenCalledTimes(1);
    expect(result.current.xp?.total).toBeGreaterThan(0);
    db.close();
  });
});
