// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createDeviceSettingsRepository } from "../../../src/storage/repositories/deviceSettingsRepository.js";
import { useOnboarding } from "../../../src/app/hooks/useOnboarding.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useOnboarding", () => {
  it("resolves completed: false on a fresh device", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useOnboarding(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.completed).toBe(false);
    db.close();
  });

  it("resolves completed: true when the device already finished onboarding", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createDeviceSettingsRepository(db).update({ onboardingCompleted: true });
    const { result } = renderHook(() => useOnboarding(), { wrapper: withDatabase(db) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.completed).toBe(true);
    db.close();
  });

  it("complete() persists onboardingCompleted and flips local state", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useOnboarding(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.completed).toBe(false);

    await act(async () => {
      await result.current.complete();
    });

    expect(result.current.completed).toBe(true);
    const persisted = await createDeviceSettingsRepository(db).get();
    expect(persisted.onboardingCompleted).toBe(true);
    db.close();
  });
});
