// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { createDerivedStateRepository } from "../../../src/storage/repositories/derivedStateRepository.js";
import { useLifetimeLevel } from "../../../src/app/hooks/useLifetimeLevel.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("useLifetimeLevel", () => {
  it("is level 1 with no xp on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useLifetimeLevel(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.level).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 100 });
    db.close();
  });

  it("reflects xp earned once the derived cache has been rebuilt", async () => {
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

    const { result } = renderHook(() => useLifetimeLevel(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.level?.level).toBe(1);
    expect(result.current.level?.xpIntoLevel).toBeGreaterThan(0);
    db.close();
  });
});
