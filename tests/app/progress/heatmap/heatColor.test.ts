import { describe, it, expect } from "vitest";
import { heatColor } from "../../../../src/app/progress/heatmap/heatColor.js";

describe("heatColor", () => {
  it("returns the cold surface color at heat 0 and the hot plate-red at heat 1", () => {
    expect(heatColor(0)).toBe("#2a2724");
    expect(heatColor(1)).toBe("#d4342a");
  });

  it("passes through each named stop exactly", () => {
    expect(heatColor(0.33)).toBe("#1e6fbf");
    expect(heatColor(0.66)).toBe("#e8b317");
  });

  it("clamps out-of-range input instead of extrapolating", () => {
    expect(heatColor(-5)).toBe(heatColor(0));
    expect(heatColor(5)).toBe(heatColor(1));
  });

  it("is monotonically well-defined (every value in [0,1] returns a valid hex color)", () => {
    for (let h = 0; h <= 1; h += 0.05) {
      expect(heatColor(h)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
