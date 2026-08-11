// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { useDeviceSettings } from "../../../src/app/hooks/useDeviceSettings.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useDeviceSettings", () => {
  it("resolves sane defaults on a fresh device", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useDeviceSettings(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deviceSettings?.restTimerAutoStart).toBe(true);
    expect(result.current.deviceSettings?.reduceMotion).toBe(false);
    db.close();
  });

  it("update() persists a patch and reflects it immediately", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useDeviceSettings(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update({ restTimerAutoStart: false });
    });

    expect(result.current.deviceSettings?.restTimerAutoStart).toBe(false);
    db.close();
  });
});
