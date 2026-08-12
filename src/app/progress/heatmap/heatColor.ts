// Cold-to-hot ramp for the body heatmap: dark navy (matching the
// heatmap card's own background, so an untrained facet reads as barely
// distinguishable "cut" in the surface) through muted sea-green up to a
// bright mint for a muscle trained very recently.
const STOPS: Array<{ at: number; hex: string }> = [
  { at: 0, hex: "10182b" }, // near-black navy: cold / not recently trained
  { at: 0.35, hex: "1c5c52" }, // muted teal-green
  { at: 0.7, hex: "1fae9c" }, // teal
  { at: 1, hex: "5eead4" }, // bright mint: hot / fresh
];

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

// heat is 0-1 (heatmap/views.ts's RecencyMapEntry.heat, already clamped
// there) — clamped again here since this is also reachable directly from
// tests/hand-authored data that may not go through that clamp.
export function heatColor(heat: number): string {
  const clamped = Math.min(1, Math.max(0, heat));
  let lower = STOPS[0]!;
  let upper = STOPS[STOPS.length - 1]!;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (clamped >= STOPS[i]!.at && clamped <= STOPS[i + 1]!.at) {
      lower = STOPS[i]!;
      upper = STOPS[i + 1]!;
      break;
    }
  }
  const span = upper.at - lower.at;
  const t = span > 0 ? (clamped - lower.at) / span : 0;
  const [r1, g1, b1] = hexToRgb(lower.hex);
  const [r2, g2, b2] = hexToRgb(upper.hex);
  const r = lerp(r1, r2, t).toString(16).padStart(2, "0");
  const g = lerp(g1, g2, t).toString(16).padStart(2, "0");
  const b = lerp(b1, b2, t).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}
