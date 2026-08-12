import type { MuscleId } from "../../../domain/muscles.js";

// Hand-authored faceted anatomical body diagram (front + back) — low-poly
// angular segments rather than soft rounded blobs, matching the visual
// language of the reference "muscle heatmap" widgets this was modeled on
// (dark navy card, teal-on-navy facets, front/back shown side by side).
export const VIEWBOX_WIDTH = 240;
export const VIEWBOX_HEIGHT = 480;

export type Point = [number, number];

export interface RegionShape {
  points: Point[];
}

function mirrorPoint([x, y]: Point): Point {
  return [VIEWBOX_WIDTH - x, y];
}

function mirror(shape: RegionShape): RegionShape {
  return { points: shape.points.map(mirrorPoint) };
}

function paired(shape: RegionShape): RegionShape[] {
  return [shape, mirror(shape)];
}

// A beveled rectangle — cutting each corner turns a plain rect into an
// angular octagon (or, at a large bevel fraction on a near-square box, a
// diamond) without hand-plotting every vertex. bevelFrac is a fraction of
// the shorter side, clamped so opposite bevels can never cross.
function octagon(x: number, y: number, w: number, h: number, bevelFrac: number): RegionShape {
  const bevel = Math.min(w, h) * Math.min(bevelFrac, 0.5);
  return {
    points: [
      [x + bevel, y],
      [x + w - bevel, y],
      [x + w, y + bevel],
      [x + w, y + h - bevel],
      [x + w - bevel, y + h],
      [x + bevel, y + h],
      [x, y + h - bevel],
      [x, y + bevel],
    ],
  };
}

// A 6-point polygon inscribed in an ellipse — used for rounded caps
// (deltoids, glutes, head, hands, feet) so they read as angular facets
// like everything else instead of true curves.
function hexFromEllipse(cx: number, cy: number, rx: number, ry: number): RegionShape {
  const angles = [-90, -30, 30, 90, 150, 210];
  return { points: angles.map((deg) => [cx + rx * Math.cos((deg * Math.PI) / 180), cy + ry * Math.sin((deg * Math.PI) / 180)] as Point) };
}

function mirrorLine(points: Point[]): Point[] {
  return points.map(mirrorPoint);
}

// Non-interactive body outline drawn beneath every muscle region, so gaps
// between regions (hands, feet, skull) still read as a body rather than
// floating facets. Identical for both views — only the shaded regions on
// top differ between front and back.
export const BASE_SHAPES: RegionShape[] = [
  { points: [[104, 10], [136, 10], [146, 30], [136, 54], [104, 54], [94, 30]] }, // head
  octagon(88, 56, 64, 172, 0.16), // torso backdrop
  octagon(74, 210, 92, 40, 0.3), // pelvis backdrop
  ...paired(hexFromEllipse(44, 258, 11, 14)), // hands
  ...paired(hexFromEllipse(96, 436, 15, 12)), // feet
];

export interface MuscleRegion {
  muscleId: MuscleId;
  shapes: RegionShape[];
}

// Purely decorative seam lines layered on top of a muscle's own fill —
// e.g. the abdominal grid or a quad/calf split — drawn in the card's own
// background color so they read as gaps between facets, the same trick
// the reference diagrams use. Never a hit target: these never carry a
// muscleId, so they can't affect which muscle a tap resolves to.
export interface Seam {
  view: "front" | "back" | "both";
  points: Point[];
}

export const SEAMS: Seam[] = [
  // Abdominal grid: two horizontal splits + one vertical, over the single
  // abs muscle region (150,150)-(140,212) — six-pack look, one muscle.
  { view: "front", points: [[104, 172], [136, 172]] },
  { view: "front", points: [[104, 194], [136, 194]] },
  { view: "front", points: [[120, 150], [120, 212]] },
  // Quad inner/outer split, both legs.
  { view: "front", points: [[91, 226], [91, 308]] },
  { view: "front", points: mirrorLine([[91, 226], [91, 308]]) },
  // Hamstring inner/outer split, both legs.
  { view: "back", points: [[98, 236], [98, 312]] },
  { view: "back", points: mirrorLine([[98, 236], [98, 312]]) },
  // Calf split, both legs, both views.
  { view: "both", points: [[94, 340], [94, 402]] },
  { view: "both", points: mirrorLine([[94, 340], [94, 402]]) },
];

export const FRONT_REGIONS: MuscleRegion[] = [
  { muscleId: "neck", shapes: [octagon(104, 52, 32, 20, 0.3)] },
  { muscleId: "trapUpper", shapes: paired(octagon(82, 62, 28, 16, 0.3)) },
  { muscleId: "deltLateral", shapes: paired(hexFromEllipse(58, 92, 11, 15)) },
  { muscleId: "deltAnterior", shapes: paired(hexFromEllipse(72, 98, 16, 20)) },
  { muscleId: "chestClavicular", shapes: paired(octagon(82, 90, 34, 18, 0.25)) },
  { muscleId: "chestSternal", shapes: paired(octagon(80, 110, 36, 36, 0.2)) },
  { muscleId: "biceps", shapes: paired(octagon(52, 118, 20, 54, 0.25)) },
  { muscleId: "obliques", shapes: paired(octagon(78, 152, 17, 46, 0.25)) },
  { muscleId: "abs", shapes: [octagon(100, 150, 40, 62, 0.15)] },
  { muscleId: "forearms", shapes: paired(octagon(48, 176, 18, 58, 0.25)) },
  { muscleId: "adductors", shapes: paired(octagon(102, 224, 17, 48, 0.2)) },
  { muscleId: "quads", shapes: paired(octagon(76, 222, 30, 90, 0.2)) },
  { muscleId: "calves", shapes: paired(octagon(82, 336, 24, 70, 0.25)) },
];

export const BACK_REGIONS: MuscleRegion[] = [
  { muscleId: "neck", shapes: [octagon(104, 52, 32, 20, 0.3)] },
  { muscleId: "trapUpper", shapes: paired(octagon(82, 62, 28, 16, 0.3)) },
  { muscleId: "trapMid", shapes: [octagon(96, 80, 48, 28, 0.45)] },
  { muscleId: "trapLower", shapes: [octagon(104, 108, 32, 26, 0.4)] },
  { muscleId: "rhomboids", shapes: paired(octagon(92, 98, 18, 22, 0.3)) },
  { muscleId: "deltLateral", shapes: paired(hexFromEllipse(58, 92, 11, 15)) },
  { muscleId: "deltPosterior", shapes: paired(hexFromEllipse(72, 98, 16, 20)) },
  { muscleId: "lats", shapes: paired({ points: [[70, 116], [92, 124], [88, 168], [74, 182], [58, 168], [60, 130]] }) },
  { muscleId: "tricepsLateral", shapes: paired(octagon(50, 118, 20, 22, 0.25)) },
  { muscleId: "tricepsLong", shapes: paired(octagon(50, 142, 20, 32, 0.25)) },
  { muscleId: "obliques", shapes: paired(octagon(76, 166, 16, 40, 0.25)) },
  { muscleId: "lowerBack", shapes: [octagon(98, 180, 44, 34, 0.2)] },
  { muscleId: "forearms", shapes: paired(octagon(48, 176, 18, 58, 0.25)) },
  { muscleId: "glutes", shapes: paired(hexFromEllipse(100, 228, 22, 26)) },
  { muscleId: "abductors", shapes: paired(octagon(64, 232, 16, 58, 0.25)) },
  { muscleId: "hamstrings", shapes: paired(octagon(82, 232, 32, 86, 0.2)) },
  { muscleId: "calves", shapes: paired(octagon(82, 336, 24, 70, 0.25)) },
];
