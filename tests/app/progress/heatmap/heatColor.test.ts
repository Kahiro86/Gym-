import { describe, it, expect } from "vitest";
import { heatColor } from "../../../../src/app/progress/heatmap/heatColor.js";

describe("heatColor", () => {
  it("returns near-black navy at heat 0 and bright mint at heat 1", () => {
    expect(heatColor(0)).toBe("#10182b");
    expect(heatColor(1)).toBe("#5eead4");
  });

  it("passes through each named stop exactly", () => {
    expect(heatColor(0.35)).toBe("#1c5c52");
    expect(heatColor(0.7)).toBe("#1fae9c");
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
