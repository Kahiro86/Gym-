import { describe, it, expect } from "vitest";
import { musclesInView } from "../../../../src/domain/muscles.js";
import { BACK_REGIONS, FRONT_REGIONS, SEAMS, VIEWBOX_HEIGHT, VIEWBOX_WIDTH } from "../../../../src/app/progress/heatmap/bodyRegions.js";

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

  it("every region's polygon points stay within the viewBox", () => {
    for (const region of [...FRONT_REGIONS, ...BACK_REGIONS]) {
      for (const shape of region.shapes) {
        expect(shape.points.length).toBeGreaterThanOrEqual(3);
        for (const [x, y] of shape.points) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(VIEWBOX_WIDTH);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(VIEWBOX_HEIGHT);
        }
      }
    }
  });

  it("every mirrored region pair stays symmetric about the vertical centerline", () => {
    for (const region of [...FRONT_REGIONS, ...BACK_REGIONS]) {
      if (region.shapes.length !== 2) continue; // unpaired (midline) muscles have exactly one shape
      const [left, right] = region.shapes;
      expect(left!.points.length).toBe(right!.points.length);
      for (let i = 0; i < left!.points.length; i++) {
        const [lx, ly] = left!.points[i]!;
        const [rx, ry] = right!.points[i]!;
        expect(lx + rx).toBeCloseTo(VIEWBOX_WIDTH, 5);
        expect(ly).toBeCloseTo(ry, 5);
      }
    }
  });

  it("every seam decoration's points stay within the viewBox", () => {
    for (const seam of SEAMS) {
      for (const [x, y] of seam.points) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(VIEWBOX_WIDTH);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(VIEWBOX_HEIGHT);
      }
    }
  });
});
