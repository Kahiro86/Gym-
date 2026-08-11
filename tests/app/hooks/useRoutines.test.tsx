// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { useRoutines } from "../../../src/app/hooks/useRoutines.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useRoutines", () => {
  it("starts empty on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useRoutines(), { wrapper: withDatabase(db) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routines).toEqual([]);
    db.close();
  });

  it("create() adds a routine and refreshes the list, name-sorted", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useRoutines(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ name: "Push Day" });
    });
    await act(async () => {
      await result.current.create({ name: "Leg Day" });
    });

    expect(result.current.routines.map((r) => r.name)).toEqual(["Leg Day", "Push Day"]);
    db.close();
  });

  it("remove() soft-deletes a routine out of the list", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useRoutines(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createdId = "";
    await act(async () => {
      createdId = (await result.current.create({ name: "Push Day" })).id;
    });
    expect(result.current.routines).toHaveLength(1);

    await act(async () => {
      await result.current.remove(createdId);
    });
    expect(result.current.routines).toEqual([]);
    db.close();
  });
});
