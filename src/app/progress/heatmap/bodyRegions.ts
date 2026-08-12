import type { MuscleId } from "../../../domain/muscles.js";

// Hand-authored stylized body diagram (front + back), same spirit as
// PlateLoader (spec §14 task 8) — not anatomically precise, just legible
// enough at 390px width to tap the right muscle and read its heat.
export const VIEWBOX_WIDTH = 240;
export const VIEWBOX_HEIGHT = 480;

export type RegionShape =
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "rect"; x: number; y: number; width: number; height: number; rx: number };

// Every muscle is authored once, left-of-center; bilateral muscles are
// mirrored automatically so a left/right pair never drifts out of sync by
// hand-editing one side and forgetting the other.
function mirror(shape: RegionShape): RegionShape {
  return shape.type === "ellipse" ? { ...shape, cx: VIEWBOX_WIDTH - shape.cx } : { ...shape, x: VIEWBOX_WIDTH - shape.x - shape.width };
}

function paired(shape: RegionShape): RegionShape[] {
  return [shape, mirror(shape)];
}

export interface MuscleRegion {
  muscleId: MuscleId;
  shapes: RegionShape[];
}

// Non-interactive body outline drawn beneath every muscle region, so gaps
// between regions (hands, feet, skull) still read as a body rather than
// floating blobs. Identical for both views — only the shaded regions on
// top differ between front and back.
export const BASE_SHAPES: RegionShape[] = [
  { type: "ellipse", cx: 120, cy: 32, rx: 20, ry: 24 }, // head
  { type: "rect", x: 88, y: 56, width: 64, height: 172, rx: 26 }, // torso backdrop
  { type: "rect", x: 74, y: 210, width: 92, height: 40, rx: 18 }, // pelvis backdrop
  ...paired({ type: "ellipse", cx: 44, cy: 258, rx: 11, ry: 14 }), // hands
  ...paired({ type: "ellipse", cx: 96, cy: 436, rx: 15, ry: 12 }), // feet
];

export const FRONT_REGIONS: MuscleRegion[] = [
  { muscleId: "neck", shapes: [{ type: "rect", x: 104, y: 52, width: 32, height: 20, rx: 8 }] },
  { muscleId: "trapUpper", shapes: paired({ type: "rect", x: 82, y: 62, width: 28, height: 16, rx: 6 }) },
  { muscleId: "deltLateral", shapes: paired({ type: "ellipse", cx: 58, cy: 92, rx: 11, ry: 15 }) },
  { muscleId: "deltAnterior", shapes: paired({ type: "ellipse", cx: 72, cy: 98, rx: 16, ry: 20 }) },
  { muscleId: "chestClavicular", shapes: paired({ type: "rect", x: 82, y: 90, width: 34, height: 18, rx: 9 }) },
  { muscleId: "chestSternal", shapes: paired({ type: "rect", x: 80, y: 110, width: 36, height: 36, rx: 12 }) },
  { muscleId: "biceps", shapes: paired({ type: "rect", x: 52, y: 118, width: 20, height: 54, rx: 10 }) },
  { muscleId: "obliques", shapes: paired({ type: "rect", x: 78, y: 152, width: 17, height: 46, rx: 8 }) },
  { muscleId: "abs", shapes: [{ type: "rect", x: 100, y: 150, width: 40, height: 62, rx: 10 }] },
  { muscleId: "forearms", shapes: paired({ type: "rect", x: 48, y: 176, width: 18, height: 58, rx: 9 }) },
  { muscleId: "adductors", shapes: paired({ type: "rect", x: 102, y: 224, width: 17, height: 48, rx: 8 }) },
  { muscleId: "quads", shapes: paired({ type: "rect", x: 76, y: 222, width: 30, height: 90, rx: 14 }) },
  { muscleId: "calves", shapes: paired({ type: "rect", x: 82, y: 336, width: 24, height: 70, rx: 10 }) },
];

export const BACK_REGIONS: MuscleRegion[] = [
  { muscleId: "neck", shapes: [{ type: "rect", x: 104, y: 52, width: 32, height: 20, rx: 8 }] },
  { muscleId: "trapUpper", shapes: paired({ type: "rect", x: 82, y: 62, width: 28, height: 16, rx: 6 }) },
  { muscleId: "trapMid", shapes: [{ type: "rect", x: 96, y: 80, width: 48, height: 28, rx: 10 }] },
  { muscleId: "trapLower", shapes: [{ type: "rect", x: 104, y: 108, width: 32, height: 26, rx: 10 }] },
  { muscleId: "rhomboids", shapes: paired({ type: "rect", x: 92, y: 98, width: 18, height: 22, rx: 8 }) },
  { muscleId: "deltLateral", shapes: paired({ type: "ellipse", cx: 58, cy: 92, rx: 11, ry: 15 }) },
  { muscleId: "deltPosterior", shapes: paired({ type: "ellipse", cx: 72, cy: 98, rx: 16, ry: 20 }) },
  { muscleId: "lats", shapes: paired({ type: "rect", x: 68, y: 116, width: 26, height: 64, rx: 12 }) },
  { muscleId: "tricepsLateral", shapes: paired({ type: "rect", x: 50, y: 118, width: 20, height: 22, rx: 8 }) },
  { muscleId: "tricepsLong", shapes: paired({ type: "rect", x: 50, y: 142, width: 20, height: 32, rx: 8 }) },
  { muscleId: "obliques", shapes: paired({ type: "rect", x: 76, y: 166, width: 16, height: 40, rx: 8 }) },
  { muscleId: "lowerBack", shapes: [{ type: "rect", x: 98, y: 180, width: 44, height: 34, rx: 10 }] },
  { muscleId: "forearms", shapes: paired({ type: "rect", x: 48, y: 176, width: 18, height: 58, rx: 9 }) },
  { muscleId: "glutes", shapes: paired({ type: "ellipse", cx: 100, cy: 228, rx: 22, ry: 26 }) },
  { muscleId: "abductors", shapes: paired({ type: "rect", x: 64, y: 232, width: 16, height: 58, rx: 8 }) },
  { muscleId: "hamstrings", shapes: paired({ type: "rect", x: 82, y: 232, width: 32, height: 86, rx: 14 }) },
  { muscleId: "calves", shapes: paired({ type: "rect", x: 82, y: 336, width: 24, height: 70, rx: 10 }) },
];
