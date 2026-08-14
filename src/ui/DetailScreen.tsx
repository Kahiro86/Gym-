// Screen 2 — habit detail. Four cards, in the spec's order, all visible
// in one scroll. Each card owns its own period toggle and its own read,
// so changing one never disturbs another.
import { useCallback, useState } from "react";
import { db } from "../db/index.js";
import {
  getDetailHeader, getOverview, getScoreTrend, getHistory,
  getScoreColor, SCORE_COLOR_HEX,
} from "../logic/index.js";
import type { DetailHeader, Overview, Period, TrendPoint, HistoryBucket } from "../logic/index.js";
import type { Habit } from "../db/types.js";
import { useAsync } from "./useAsync.js";
import { ChevronLeftIcon, EditIcon, MoreIcon, FlameIcon, TrophyIcon, RepeatIcon, CalendarIcon } from "./icons.js";
import "./DetailScreen.css";

// ── Period toggle ─────────────────────────────────────────────────────
function PeriodToggle<T extends string>({ options, value, onChange, label }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="toggle" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="toggle__option"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

// ── B. Overview ring ──────────────────────────────────────────────────
const RING_SIZE = 78;
const RING_STROKE = 7;
const RING_RADIUS = 32;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ score }: { score: number }) {
  const center = RING_SIZE / 2;
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      role="img"
      aria-label={`Score ${score} percent`}
    >
      <circle cx={center} cy={center} r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth={RING_STROKE} />
      {/* Omitted entirely at 0: a round cap still paints a dot on a
          zero-length arc, which would read as a sliver of progress. */}
      {score > 0 && (
        <circle
          cx={center} cy={center} r={RING_RADIUS} fill="none"
          stroke={SCORE_COLOR_HEX[getScoreColor(score)]}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          // Fills clockwise from 12 o'clock.
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - score / 100)}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text x={center} y={center - 4} textAnchor="middle" fontSize="17" fontWeight="500" fill="var(--text-primary)">
        {score}%
      </text>
      <text x={center} y={center + 10} textAnchor="middle" fontSize="9" fill="var(--text-secondary)">
        score
      </text>
    </svg>
  );
}

/** A delta is green up, red down, and never gold. Unknown reads as a dash. */
function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return (
      <div>
        <span className="delta--none" title="Not enough history to compare yet">—</span>{" "}
        <span className="delta__label">{label}</span>
      </div>
    );
  }
  const cls = value > 0 ? "delta--up" : value < 0 ? "delta--down" : "delta--none";
  return (
    <div>
      <span className={cls}>{value > 0 ? `+${value}` : value}%</span>{" "}
      <span className="delta__label">{label}</span>
    </div>
  );
}

// ── C. Trend line ─────────────────────────────────────────────────────
const TREND_W = 300;
const TREND_H = 70;

function TrendChart({ points }: { points: TrendPoint[] }) {
  // A single point is not a trend, and drawing one would imply a shape
  // the data does not have.
  if (points.length < 2) {
    return <div className="chart__empty">Not enough data yet</div>;
  }
  const pad = 6;
  const usableH = TREND_H - pad * 2;
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * TREND_W;
    const y = pad + (1 - p.score / 100) * usableH;
    return { x, y, ...p };
  });
  const last = xy[xy.length - 1];
  const first = points[0];
  const latest = points[points.length - 1];

  return (
    <svg
      className="chart"
      height={TREND_H}
      viewBox={`0 0 ${TREND_W} ${TREND_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Score trend across ${points.length} points, from ${first.score}% on ${first.date} to ${latest.score}% on ${latest.date}`}
    >
      <polyline
        points={xy.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="var(--accent-gold)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r={3} fill="var(--accent-gold)" />
    </svg>
  );
}

// ── D. History bars ───────────────────────────────────────────────────
const HIST_W = 300;
const HIST_H = 60;

function HistoryChart({ buckets }: { buckets: HistoryBucket[] }) {
  if (buckets.length === 0) {
    return <div className="chart__empty">Not enough data yet</div>;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const slot = HIST_W / buckets.length;
  const barW = Math.min(26, slot * 0.62);
  const floor = HIST_H - 8;
  const top = 12;

  return (
    <svg className="chart" height={HIST_H} viewBox={`0 0 ${HIST_W} ${HIST_H}`} role="img"
      aria-label={`Completions per period: ${buckets.map((b) => `${b.start} ${b.count}`).join(", ")}`}>
      {buckets.map((b) => {
        const x = (buckets.indexOf(b) + 0.5) * slot - barW / 2;
        const h = Math.max(3, (b.count / max) * (floor - top));
        return (
          <g key={b.start}>
            <rect
              x={x} y={floor - h} width={barW} height={h} rx={3}
              fill={b.met ? "var(--accent-gold)" : "var(--cell-empty)"}
            />
            {/* Only completed (target-met) bars are labelled, per spec. */}
            {b.met && (
              <text x={x + barW / 2} y={floor - h - 3} textAnchor="middle" fontSize="9" fill="var(--text-secondary)">
                {b.count}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Shared card scaffolding ───────────────────────────────────────────
function Card({ label, toggle, children }: {
  label: string;
  toggle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card__head">
        <span className="card__label">{label}</span>
        {toggle}
      </div>
      {children}
    </section>
  );
}

function CardError({ error }: { error: Error }) {
  return <div className="chart__empty" role="alert">{error.message}</div>;
}

// ── Screen ────────────────────────────────────────────────────────────
const OVERVIEW_PERIODS = ["week", "month", "year"] as const;
const TREND_PERIODS = ["week", "month", "year"] as const;
const HISTORY_PERIODS = ["week", "month"] as const;

export function DetailScreen({ habitId, onBack, onOpenCalendar }: { habitId: string; onBack: () => void; onOpenCalendar: () => void }) {
  // Three independent toggles: changing one never moves another.
  const [overviewPeriod, setOverviewPeriod] = useState<Period>("month");
  const [trendPeriod, setTrendPeriod] = useState<Period>("week");
  const [historyPeriod, setHistoryPeriod] = useState<"week" | "month">("week");

  const header = useAsync<DetailHeader>(useCallback(() => getDetailHeader(db, habitId), [habitId]), [habitId]);
  const overview = useAsync<Overview>(
    useCallback(() => getOverview(db, habitId, overviewPeriod), [habitId, overviewPeriod]),
    [habitId, overviewPeriod],
  );
  const trend = useAsync<TrendPoint[]>(
    useCallback(() => getScoreTrend(db, habitId, trendPeriod), [habitId, trendPeriod]),
    [habitId, trendPeriod],
  );
  const history = useAsync<HistoryBucket[]>(
    useCallback(() => getHistory(db, habitId, historyPeriod), [habitId, historyPeriod]),
    [habitId, historyPeriod],
  );

  const habit: Habit | null = header.status === "ready" ? header.data.habit : null;

  return (
    <div className="screen">
      <header className="detail-topbar">
        <button type="button" className="detail-topbar__icon" onClick={onBack} aria-label="Back to habits">
          <ChevronLeftIcon size={20} />
        </button>
        <span className="detail-topbar__title">{habit?.name ?? "…"}</span>
        {/* The spec describes the calendar as its own screen but never
            says how to reach it, so this is the entry point. */}
        <button type="button" className="detail-topbar__icon" onClick={onOpenCalendar}
          aria-label="Calendar and streaks">
          <CalendarIcon />
        </button>
        {/* Edit and overflow are part of Loop's header. The spec defines
            no behaviour for either, so none is invented here. */}
        <span className="detail-topbar__icon" aria-hidden><EditIcon /></span>
        <span className="detail-topbar__icon" aria-hidden><MoreIcon /></span>
      </header>

      {/* A. Header card */}
      <section className="card">
        {header.status === "loading" && (
          <div aria-busy="true" aria-label="Loading habit">
            <div className="sk sk--line" style={{ width: "60%", marginBottom: 10 }} />
            <div className="sk sk--line" style={{ width: "40%" }} />
          </div>
        )}
        {header.status === "error" && <CardError error={header.error} />}
        {header.status === "ready" && (
          <>
            {header.data.habit.question && <div className="header__question">{header.data.habit.question}</div>}
            <div className="header__meta">
              <span className="header__meta-item"><RepeatIcon size={12} />{header.data.frequencyLabel}</span>
              <span className="header__meta-item"><FlameIcon size={12} />streak {header.data.currentStreak}</span>
              <span className="header__meta-item"><TrophyIcon size={12} />best {header.data.bestStreak}</span>
            </div>
          </>
        )}
      </section>

      {/* B. Overview */}
      <Card
        label="overview"
        toggle={<PeriodToggle options={OVERVIEW_PERIODS} value={overviewPeriod as typeof OVERVIEW_PERIODS[number]}
          onChange={setOverviewPeriod} label="Overview period" />}
      >
        {overview.status === "loading" && (
          <div className="overview" aria-busy="true" aria-label="Loading overview">
            <div className="sk sk--ring" />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="sk sk--line" style={{ width: "70%" }} />
              <div className="sk sk--line" style={{ width: "55%" }} />
              <div className="sk sk--line" style={{ width: "45%" }} />
            </div>
          </div>
        )}
        {overview.status === "error" && <CardError error={overview.error} />}
        {overview.status === "ready" && (
          <div className="overview">
            <ScoreRing score={overview.data.score} />
            <div className="overview__deltas">
              <Delta value={overview.data.monthDelta} label="this month" />
              <Delta value={overview.data.yearDelta} label="this year" />
              <div>
                <span className="delta__total">{overview.data.total}</span>{" "}
                <span className="delta__label">total</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* C. Score trend */}
      <Card
        label="score trend"
        toggle={<PeriodToggle options={TREND_PERIODS} value={trendPeriod as typeof TREND_PERIODS[number]}
          onChange={setTrendPeriod} label="Trend period" />}
      >
        {trend.status === "loading" && <div className="sk sk--chart" aria-busy="true" aria-label="Loading trend" />}
        {trend.status === "error" && <CardError error={trend.error} />}
        {trend.status === "ready" && <TrendChart points={trend.data} />}
      </Card>

      {/* D. History */}
      <Card
        label="history"
        toggle={<PeriodToggle options={HISTORY_PERIODS} value={historyPeriod}
          onChange={setHistoryPeriod} label="History period" />}
      >
        {history.status === "loading" && <div className="sk sk--chart" aria-busy="true" aria-label="Loading history" />}
        {history.status === "error" && <CardError error={history.error} />}
        {history.status === "ready" && <HistoryChart buckets={history.data} />}
      </Card>
    </div>
  );
}
