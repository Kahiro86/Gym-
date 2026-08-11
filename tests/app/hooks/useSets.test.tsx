// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { useSets } from "../../../src/app/hooks/useSets.js";
import { uniqueDbName, withDatabase } from "../testDb.js";
import type { SessionExerciseRecord } from "../../../src/storage/types.js";

const BENCH = "barbell-bench-press";

async function seedSessionExercise(db: GymDatabase): Promise<SessionExerciseRecord> {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const session = await sessions.create({ startedAt: 1000 });
  return sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
}

describe("useSets", () => {
  it("starts empty for a fresh sessionExercise and reflects a logged set", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db);
    const { result } = renderHook(() => useSets(se.id), { wrapper: withDatabase(db) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sets).toEqual([]);

    await act(async () => {
      await result.current.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    });

    expect(result.current.sets).toHaveLength(1);
    expect(result.current.sets[0]!.weightKg).toBe(60);
    db.close();
  });

  it("returns no sets and never queries when sessionExerciseId is null", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSets(null), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sets).toEqual([]);
    db.close();
  });

  it("remove() soft-deletes a set out of the list", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db);
    const { result } = renderHook(() => useSets(se.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let loggedId = "";
    await act(async () => {
      loggedId = (
        await result.current.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 })
      ).id;
    });
    expect(result.current.sets).toHaveLength(1);

    await act(async () => {
      await result.current.remove(loggedId);
    });
    expect(result.current.sets).toEqual([]);
    db.close();
  });

  it("re-queries when switching to a different sessionExerciseId", async () => {
    const db = new GymDatabase(uniqueDbName());
    const seA = await seedSessionExercise(db);
    const sets = createSessionExerciseRepository(db);
    const seB = await sets.add({ sessionId: seA.sessionId, exerciseId: "back-squat" });

    const { result, rerender } = renderHook(({ id }) => useSets(id), {
      wrapper: withDatabase(db),
      initialProps: { id: seA.id as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.log({ sessionExerciseId: seA.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    });
    expect(result.current.sets).toHaveLength(1);

    rerender({ id: seB.id });
    await waitFor(() => expect(result.current.sets).toEqual([]));
    db.close();
  });
});
