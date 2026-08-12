// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { useCurrentStreak } from "../../../src/app/hooks/useCurrentStreak.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("useCurrentStreak", () => {
  it("is 0 on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useCurrentStreak(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.streakWeeks).toBe(0);
    db.close();
  });

  it("counts a session trained just now", async () => {
    const db = new GymDatabase(uniqueDbName());
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);

    const now = Date.now();
    const session = await sessions.create({ startedAt: now });
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: now });
    await sessions.finish(session.id, now + 100);

    const { result } = renderHook(() => useCurrentStreak(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.streakWeeks).toBe(1);
    db.close();
  });
});
