// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createRoutineRepository } from "../../../src/storage/repositories/routineRepository.js";
import { useRoutineExercises } from "../../../src/app/hooks/useRoutineExercises.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";
const SQUAT = "back-squat";

describe("useRoutineExercises", () => {
  it("is empty for a routine with no exercises yet", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    const { result } = renderHook(() => useRoutineExercises(routine.id), { wrapper: withDatabase(db) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routineExercises).toEqual([]);
    db.close();
  });

  it("add() appends an exercise, order-index sorted", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    const { result } = renderHook(() => useRoutineExercises(routine.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.add({ routineId: routine.id, exerciseId: BENCH });
    });
    await act(async () => {
      await result.current.add({ routineId: routine.id, exerciseId: SQUAT });
    });

    expect(result.current.routineExercises.map((re) => re.exerciseId)).toEqual([BENCH, SQUAT]);
    db.close();
  });

  it("update() patches target sets/reps", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    const { result } = renderHook(() => useRoutineExercises(routine.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let id = "";
    await act(async () => {
      id = (await result.current.add({ routineId: routine.id, exerciseId: BENCH })).id;
    });
    await act(async () => {
      await result.current.update(id, { targetSets: 5, targetReps: 5 });
    });

    expect(result.current.routineExercises[0]!.targetSets).toBe(5);
    expect(result.current.routineExercises[0]!.targetReps).toBe(5);
    db.close();
  });

  it("remove() soft-deletes an exercise out of the list", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    const { result } = renderHook(() => useRoutineExercises(routine.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let id = "";
    await act(async () => {
      id = (await result.current.add({ routineId: routine.id, exerciseId: BENCH })).id;
    });
    expect(result.current.routineExercises).toHaveLength(1);

    await act(async () => {
      await result.current.remove(id);
    });
    expect(result.current.routineExercises).toEqual([]);
    db.close();
  });
});
