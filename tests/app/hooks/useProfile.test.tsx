// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { useProfile } from "../../../src/app/hooks/useProfile.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useProfile", () => {
  it("resolves an empty singleton profile on a fresh device", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useProfile(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.heightCm).toBeNull();
    expect(result.current.profile?.sex).toBeNull();
    db.close();
  });

  it("update() persists a patch and reflects it immediately", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useProfile(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update({ heightCm: 180, sex: "male", birthDate: "1990-01-01" });
    });

    expect(result.current.profile?.heightCm).toBe(180);
    expect(result.current.profile?.sex).toBe("male");
    expect(result.current.profile?.birthDate).toBe("1990-01-01");
    db.close();
  });
});
