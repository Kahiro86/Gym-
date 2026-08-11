// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { useExerciseSearch } from "../../../src/app/hooks/useExerciseSearch.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useExerciseSearch", () => {
  it("returns matches from the built-in catalog for a query", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useExerciseSearch("bench press"), { wrapper: withDatabase(db) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results.length).toBeGreaterThan(0);
    expect(result.current.results.some((e) => e.id === "barbell-bench-press")).toBe(true);
    expect(result.current.error).toBeNull();
    db.close();
  });

  it("re-queries when the query text changes", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result, rerender } = renderHook(({ query }) => useExerciseSearch(query), {
      wrapper: withDatabase(db),
      initialProps: { query: "bench press" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results.some((e) => e.id === "barbell-bench-press")).toBe(true);

    rerender({ query: "back squat" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.results.some((e) => e.id === "back-squat")).toBe(true));
    db.close();
  });

  it("resolves an empty query with results rather than erroring", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useExerciseSearch(""), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.results.length).toBeGreaterThan(0);
    db.close();
  });

  it("respects the limit parameter", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useExerciseSearch("", 3), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results.length).toBeLessThanOrEqual(3);
    db.close();
  });
});
