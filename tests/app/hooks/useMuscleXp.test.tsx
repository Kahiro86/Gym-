// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { createDerivedStateRepository } from "../../../src/storage/repositories/derivedStateRepository.js";
import { useMuscleXp } from "../../../src/app/hooks/useMuscleXp.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

describe("useMuscleXp", () => {
  it("is all-zero on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useMuscleXp(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.values(result.current.muscleXp ?? {}).every((xp) => xp === 0)).toBe(true);
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

    const { result } = renderHook(() => useMuscleXp(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.muscleXp?.chestSternal).toBeGreaterThan(0);
    db.close();
  });
});
