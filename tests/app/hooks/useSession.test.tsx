// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { useSession } from "../../../src/app/hooks/useSession.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useSession", () => {
  it("resolves check to null when there is no active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSession(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.check).toBeNull();
    db.close();
  });

  it("start() creates a session and refreshes check to reflect it", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSession(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createdId = "";
    await act(async () => {
      createdId = (await result.current.start(Date.now())).id;
    });

    expect(result.current.check).not.toBeNull();
    expect(result.current.check!.session.id).toBe(createdId);
    expect(result.current.check!.session.state).toBe("in_progress");
    db.close();
  });

  it("finish() on a session with no completed sets discards it, clearing check", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSession(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createdId = "";
    await act(async () => {
      createdId = (await result.current.start(Date.now())).id;
    });
    await act(async () => {
      await result.current.finish(createdId, Date.now());
    });

    expect(result.current.check).toBeNull();
    db.close();
  });

  it("propagates a repository error out of resume() rather than swallowing it", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSession(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.resume("does-not-exist")).rejects.toThrow();
    });
    db.close();
  });
});
