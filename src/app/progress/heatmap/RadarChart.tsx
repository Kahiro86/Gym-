import styles from "./RadarChart.module.css";

export interface RadarAxis {
  id: string;
  label: string;
  value: number; // 0-1
  trained: boolean;
}

export interface RadarChartProps {
  axes: RadarAxis[];
  selectedId: string | null;
  onSelect(id: string): void;
}

const SIZE = 300;
const CENTER = SIZE / 2;
const MAX_R = 85;
const LABEL_R = MAX_R + 34;
const HIT_R = MAX_R + 48; // reaches past the axis labels, safely inside the viewBox
const RING_FRACTIONS = [0.25, 0.5, 0.75, 1];

function point(angleDeg: number, r: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

function polygonPoints(angles: number[], radii: number[]): string {
  return angles.map((angle, i) => point(angle, radii[i]!).join(",")).join(" ");
}

function labelAnchor(angleDeg: number): "start" | "middle" | "end" {
  const normalized = ((angleDeg % 360) + 360) % 360;
  if (normalized === 270 || normalized === 90) return "middle";
  return normalized > 90 && normalized < 270 ? "end" : "start";
}

// A pie-slice path spanning [centerAngle - halfSpan, centerAngle + halfSpan]
// at radius r, apex at the chart's center — used as each axis's actual tap
// target (see the comment below on why a small circle at the data point
// doesn't work for this).
function wedgePath(centerAngle: number, halfSpan: number, r: number): string {
  const [x0, y0] = point(centerAngle - halfSpan, r);
  const [x1, y1] = point(centerAngle + halfSpan, r);
  return `M ${CENTER},${CENTER} L ${x0},${y0} A ${r},${r} 0 0 1 ${x1},${y1} Z`;
}

// The Progress tab's group-level heatmap — a hexagonal radar chart, one
// axis per body-region group (domain/muscles.ts's GROUPS: chest, back,
// shoulders, arms, core, legs — exactly 6, exactly what this chart draws,
// no separate grouping logic needed here). Layer 3 never computes the
// per-group heat itself; BodyHeatmap hands down already-aggregated axes.
export function RadarChart({ axes, selectedId, onSelect }: RadarChartProps) {
  const n = axes.length;
  const angles = axes.map((_, i) => -90 + i * (360 / n));
  const halfSpan = 180 / n;
  const dataRadii = axes.map((a) => Math.max(a.value, 0.04) * MAX_R);
  const dataPoints = polygonPoints(angles, dataRadii);

  return (
    <svg className={styles.svg} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Muscle group freshness radar">
      {RING_FRACTIONS.map((frac) => (
        <polygon key={frac} className={styles.ring} points={polygonPoints(angles, angles.map(() => MAX_R * frac))} />
      ))}
      {angles.map((angle, i) => {
        const [x, y] = point(angle, MAX_R);
        return <line key={i} className={styles.spoke} x1={CENTER} y1={CENTER} x2={x} y2={y} />;
      })}

      <polygon className={styles.dataFill} points={dataPoints} />
      <polygon className={styles.dataStroke} points={dataPoints} />

      {axes.map((axis, i) => {
        const [vx, vy] = point(angles[i]!, dataRadii[i]!);
        const selected = selectedId === axis.id;
        return (
          <circle
            key={axis.id}
            cx={vx}
            cy={vy}
            r={axis.trained ? 5 : 3.5}
            className={[axis.trained ? styles.vertex : styles.vertexUntrained, selected ? styles.selected : ""].filter(Boolean).join(" ")}
          />
        );
      })}

      {axes.map((axis, i) => {
        const [lx, ly] = point(angles[i]!, LABEL_R);
        return (
          <text key={axis.id} x={lx} y={ly} textAnchor={labelAnchor(angles[i]!)} dominantBaseline="middle" className={styles.axisLabel}>
            {axis.label.toUpperCase()}
          </text>
        );
      })}

      {/* Real hit targets, drawn last (on top for pointer events) but
          transparent (invisible, doesn't cover anything visually). A
          small circle centered on the data point doesn't work here: with
          6 axes, several regularly sit near zero at once (any fresh
          group, which is the common case for a new or lightly-trained
          user) — their data points all cluster within a few px of dead
          center regardless of angle, so their hit-circles fully overlap
          and only the last-drawn one is ever tappable. A pie-wedge per
          axis, spanning the chart's full radius, partitions the entire
          chart with no overlap by construction, and is also just a
          bigger, easier target than a small circle would be. */}
      {axes.map((axis, i) => {
        const selected = selectedId === axis.id;
        return (
          <path
            key={axis.id}
            d={wedgePath(angles[i]!, halfSpan, HIT_R)}
            role="button"
            tabIndex={0}
            aria-label={`${axis.label}: ${axis.trained ? `${Math.round(axis.value * 100)}% fresh` : "not trained yet"}`}
            aria-pressed={selected}
            className={styles.wedge}
            onClick={() => onSelect(axis.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(axis.id);
              }
            }}
          />
        );
      })}
    </svg>
  );
}
