// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createExerciseRepository } from "../../../src/storage/repositories/exerciseRepository.js";
import { useExercise } from "../../../src/app/hooks/useExercise.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useExercise", () => {
  it("resolves a built-in exercise by id", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useExercise("barbell-bench-press"), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exercise?.name).toBe("Barbell Bench Press");
    expect(result.current.exercise?.loadType).toBe("barbell");
    db.close();
  });

  it("resolves null immediately with no id", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useExercise(null), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exercise).toBeNull();
    db.close();
  });

  it("still resolves a hidden custom exercise (§6.5 — hiding never orphans a reference)", async () => {
    const db = new GymDatabase(uniqueDbName());
    const custom = await createExerciseRepository(db).createCustom({
      name: "Garage Landmine Press",
      loadType: "barbell",
      primaryGroup: "shoulders",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
      equipment: ["barbell"],
      defaultRestSeconds: 90,
    });
    await createExerciseRepository(db).hide(custom.id);

    const { result } = renderHook(() => useExercise(custom.id), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exercise?.name).toBe("Garage Landmine Press");
    db.close();
  });

  it("re-resolves when the exerciseId changes", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result, rerender } = renderHook(({ id }) => useExercise(id), {
      wrapper: withDatabase(db),
      initialProps: { id: "barbell-bench-press" as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exercise?.id).toBe("barbell-bench-press");

    rerender({ id: "back-squat" });
    await waitFor(() => expect(result.current.exercise?.id).toBe("back-squat"));
    db.close();
  });
});
