// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { useLastPerformance } from "../../../src/app/hooks/useLastPerformance.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("useLastPerformance", () => {
  it("resolves null when the exercise has never been logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useLastPerformance(BENCH), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lastPerformance).toBeNull();
    db.close();
  });

  it("resolves the most recent prior session's sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    const priorSession = await sessions.create({ startedAt: 1000 });
    const priorSe = await sessionExercises.add({ sessionId: priorSession.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: priorSe.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await sessions.finish(priorSession.id, 2000);

    const { result } = renderHook(() => useLastPerformance(BENCH), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lastPerformance?.session.id).toBe(priorSession.id);
    expect(result.current.lastPerformance?.sets).toHaveLength(1);
    expect(result.current.lastPerformance?.sets[0]?.weightKg).toBe(60);
    db.close();
  });

  it("excludes the given beforeSessionId (the current session)", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    const priorSession = await sessions.create({ startedAt: 1000 });
    const priorSe = await sessionExercises.add({ sessionId: priorSession.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: priorSe.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await sessions.finish(priorSession.id, 2000);

    const currentSession = await sessions.create({ startedAt: 3000 });
    const currentSe = await sessionExercises.add({ sessionId: currentSession.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: currentSe.id, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 3000 });

    const { result } = renderHook(() => useLastPerformance(BENCH, currentSession.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lastPerformance?.session.id).toBe(priorSession.id);
    expect(result.current.lastPerformance?.sets[0]?.weightKg).toBe(60);
    db.close();
  });

  it("resolves null immediately with no exerciseId", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useLastPerformance(null), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lastPerformance).toBeNull();
    db.close();
  });
});
