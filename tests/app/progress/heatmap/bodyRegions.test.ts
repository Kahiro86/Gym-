import { describe, it, expect } from "vitest";
import { musclesInView } from "../../../../src/domain/muscles.js";
import { BACK_REGIONS, FRONT_REGIONS, VIEWBOX_WIDTH } from "../../../../src/app/progress/heatmap/bodyRegions.js";

// Every muscle the domain says belongs on a view (Muscle.views,
// domain/muscles.ts) must have exactly one hand-authored region on that
// view, and vice versa — otherwise a muscle would either render nowhere
// (silently untappable) or the diagram would show a muscle that doesn't
// belong there. Same "registry-authoring integrity" spirit as
// heatmap/views.ts's own findUnmappedMuscles check.
describe("body region coverage", () => {
  it("front regions exactly match musclesInView('front')", () => {
    const expected = new Set(musclesInView("front").map((m) => m.id));
    const actual = new Set(FRONT_REGIONS.map((r) => r.muscleId));
    expect(actual).toEqual(expected);
    expect(FRONT_REGIONS).toHaveLength(expected.size);
  });

  it("back regions exactly match musclesInView('back')", () => {
    const expected = new Set(musclesInView("back").map((m) => m.id));
    const actual = new Set(BACK_REGIONS.map((r) => r.muscleId));
    expect(actual).toEqual(expected);
    expect(BACK_REGIONS).toHaveLength(expected.size);
  });

  it("every mirrored (paired) region's shapes stay within the viewBox", () => {
    for (const region of [...FRONT_REGIONS, ...BACK_REGIONS]) {
      for (const shape of region.shapes) {
        if (shape.type === "rect") {
          expect(shape.x).toBeGreaterThanOrEqual(0);
          expect(shape.x + shape.width).toBeLessThanOrEqual(VIEWBOX_WIDTH);
        } else {
          expect(shape.cx - shape.rx).toBeGreaterThanOrEqual(0);
          expect(shape.cx + shape.rx).toBeLessThanOrEqual(VIEWBOX_WIDTH);
        }
      }
    }
  });
});
