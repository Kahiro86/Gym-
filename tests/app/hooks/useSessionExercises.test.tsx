// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { useSessionExercises } from "../../../src/app/hooks/useSessionExercises.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";
const SQUAT = "back-squat";

describe("useSessionExercises", () => {
  it("starts empty for a fresh session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const session = await createSessionRepository(db).create({ startedAt: Date.now() });
    const { result } = renderHook(() => useSessionExercises(session.id), { wrapper: withDatabase(db) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessionExercises).toEqual([]);
    db.close();
  });

  it("returns [] and never queries when sessionId is null", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSessionExercises(null), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessionExercises).toEqual([]);
    db.close();
  });

  it("add() appends an exercise, order-index sorted", async () => {
    const db = new GymDatabase(uniqueDbName());
    const session = await createSessionRepository(db).create({ startedAt: Date.now() });
    const { result } = renderHook(() => useSessionExercises(session.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.add({ sessionId: session.id, exerciseId: BENCH });
    });
    await act(async () => {
      await result.current.add({ sessionId: session.id, exerciseId: SQUAT });
    });

    expect(result.current.sessionExercises.map((se) => se.exerciseId)).toEqual([BENCH, SQUAT]);
    db.close();
  });

  it("remove() soft-deletes an exercise out of the list", async () => {
    const db = new GymDatabase(uniqueDbName());
    const session = await createSessionRepository(db).create({ startedAt: Date.now() });
    const { result } = renderHook(() => useSessionExercises(session.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let addedId = "";
    await act(async () => {
      addedId = (await result.current.add({ sessionId: session.id, exerciseId: BENCH })).id;
    });
    expect(result.current.sessionExercises).toHaveLength(1);

    await act(async () => {
      await result.current.remove(addedId);
    });
    expect(result.current.sessionExercises).toEqual([]);
    db.close();
  });

  it("substitute() swaps which exercise a slot performs and stamps substitutedFromId", async () => {
    const db = new GymDatabase(uniqueDbName());
    const session = await createSessionRepository(db).create({ startedAt: Date.now() });
    const { result } = renderHook(() => useSessionExercises(session.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let addedId = "";
    await act(async () => {
      addedId = (await result.current.add({ sessionId: session.id, exerciseId: BENCH })).id;
    });

    await act(async () => {
      await result.current.substitute(addedId, SQUAT);
    });

    expect(result.current.sessionExercises).toHaveLength(1);
    expect(result.current.sessionExercises[0]?.exerciseId).toBe(SQUAT);
    expect(result.current.sessionExercises[0]?.substitutedFromId).toBe(BENCH);
    db.close();
  });
});
