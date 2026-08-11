import { describe, it, expect, afterEach, vi } from "vitest";
import { useActiveSessionStore } from "../../../src/app/store/activeSessionStore.js";

function resetStore(): void {
  useActiveSessionStore.setState({ restStartedAt: null, restDurationSec: 0 });
}

describe("activeSessionStore", () => {
  afterEach(() => {
    resetStore();
    vi.useRealTimers();
  });

  it("starts with no rest running", () => {
    expect(useActiveSessionStore.getState().restStartedAt).toBeNull();
    expect(useActiveSessionStore.getState().restDurationSec).toBe(0);
  });

  it("startRest() stamps the current wall-clock time and the given duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useActiveSessionStore.getState().startRest(90);

    expect(useActiveSessionStore.getState().restStartedAt).toBe(1_000_000);
    expect(useActiveSessionStore.getState().restDurationSec).toBe(90);
  });

  it("stopRest() clears both fields", () => {
    useActiveSessionStore.getState().startRest(90);
    useActiveSessionStore.getState().stopRest();

    expect(useActiveSessionStore.getState().restStartedAt).toBeNull();
    expect(useActiveSessionStore.getState().restDurationSec).toBe(0);
  });

  it("addRestSeconds() adjusts the duration without touching restStartedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    useActiveSessionStore.getState().startRest(60);
    useActiveSessionStore.getState().addRestSeconds(15);

    expect(useActiveSessionStore.getState().restDurationSec).toBe(75);
    expect(useActiveSessionStore.getState().restStartedAt).toBe(2_000_000);
  });

  it("addRestSeconds() never drives the duration negative", () => {
    useActiveSessionStore.getState().startRest(10);
    useActiveSessionStore.getState().addRestSeconds(-30);

    expect(useActiveSessionStore.getState().restDurationSec).toBe(0);
  });
});
