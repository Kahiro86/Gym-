// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveSessionStore } from "../../../src/app/store/activeSessionStore.js";
import { useRestRemaining } from "../../../src/app/hooks/useRestRemaining.js";

function resetStore(): void {
  useActiveSessionStore.setState({ restStartedAt: null, restDurationSec: 0 });
}

describe("useRestRemaining", () => {
  afterEach(() => {
    resetStore();
    vi.useRealTimers();
  });

  it("is null when no rest is running", () => {
    const { result } = renderHook(() => useRestRemaining());
    expect(result.current).toBeNull();
  });

  it("computes remaining time from wall-clock elapsed since restStartedAt, not a decrementing counter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useActiveSessionStore.getState().startRest(90);

    const { result } = renderHook(() => useRestRemaining());
    expect(result.current).toBe(90);

    act(() => {
      vi.setSystemTime(30_000); // 30s later
      vi.advanceTimersByTime(250); // one internal tick
    });
    expect(result.current).toBe(60);
  });

  it("jumps straight to the correct value after a long gap (simulating a throttled/backgrounded tab) instead of drifting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useActiveSessionStore.getState().startRest(120);

    const { result } = renderHook(() => useRestRemaining());
    expect(result.current).toBe(120);

    // Jump forward 100s in one go, well past several missed 250ms ticks.
    act(() => {
      vi.setSystemTime(100_000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe(20);
  });

  it("never goes below zero", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useActiveSessionStore.getState().startRest(10);

    const { result } = renderHook(() => useRestRemaining());
    act(() => {
      vi.setSystemTime(60_000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe(0);
  });
});
