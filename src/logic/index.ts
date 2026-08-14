// Layer 2 public entry point. Layer 3 imports everything it needs from
// here — never from db/index.ts directly (non-negotiable #3: the UI only
// calls the logic layer).
export { getScore, getScoreColor, SCORE_COLOR_HEX } from "./score.js";
export { getCurrentStreak, getBestStreaks, type StreakRun } from "./streak.js";
export { getScoreTrend, type TrendPoint } from "./trend.js";
export { getHistory, type HistoryBucket } from "./history.js";
export { getHeatmapData, type HeatmapDay } from "./heatmap.js";
export { getEntriesForRange, toggleEntry, setEntry } from "./entries.js";
export type { Period } from "./period.js";
