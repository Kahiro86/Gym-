// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWakeLock } from "../../../src/app/hooks/useWakeLock.js";

const originalWakeLock = (navigator as { wakeLock?: unknown }).wakeLock;

function mockWakeLock(request: (type: "screen") => Promise<{ release(): Promise<void> }>): void {
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
}

function restoreWakeLock(): void {
  if (originalWakeLock === undefined) {
    // jsdom doesn't define this property at all — a defineProperty with
    // value: undefined would still leave "wakeLock" in navigator truthy
    // for `in` checks, unlike the real absence being restored here.
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  } else {
    Object.defineProperty(navigator, "wakeLock", { value: originalWakeLock, configurable: true });
  }
}

describe("useWakeLock", () => {
  afterEach(() => {
    restoreWakeLock();
  });

  it("does not throw when navigator.wakeLock is unavailable", () => {
    restoreWakeLock();
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });

  it("does not request a lock while inactive", async () => {
    const request = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
    mockWakeLock(request);
    renderHook(() => useWakeLock(false));
    expect(request).not.toHaveBeenCalled();
  });

  it("requests a screen lock while active and releases it on unmount", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    mockWakeLock(request);

    const { unmount } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));

    unmount();
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("does not throw when the request rejects", async () => {
    mockWakeLock(vi.fn().mockRejectedValue(new Error("denied")));
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
