// Cold-to-hot ramp for the body heatmap, built from the same "calibrated
// iron" plate tokens the rest of the app already uses for meaning
// (tokens.css) rather than a fresh, unrelated color scale.
const STOPS: Array<{ at: number; hex: string }> = [
  { at: 0, hex: "2a2724" }, // --surface-raised: cold / not recently trained
  { at: 0.33, hex: "1e6fbf" }, // --plate-blue
  { at: 0.66, hex: "e8b317" }, // --plate-yellow
  { at: 1, hex: "d4342a" }, // --plate-red: hot
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
