// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { triggerHaptic } from "../../../src/app/session/haptics.js";

const originalVibrate = navigator.vibrate;

afterEach(() => {
  Object.defineProperty(navigator, "vibrate", { value: originalVibrate, configurable: true });
});

describe("triggerHaptic", () => {
  it("calls navigator.vibrate with the given pattern", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    triggerHaptic(300);
    expect(vibrate).toHaveBeenCalledWith(300);
  });

  it("defaults to a single 200ms pulse", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    triggerHaptic();
    expect(vibrate).toHaveBeenCalledWith(200);
  });

  it("does not throw when navigator.vibrate is unavailable", () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
    expect(() => triggerHaptic()).not.toThrow();
  });
});
