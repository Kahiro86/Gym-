// Layer 2 integration verification (spec §6, gate 2).
//
// The arithmetic itself is covered exhaustively and independently by the
// vitest unit suite (tests/unit) — those run against plain objects with
// no browser. What this suite adds is everything those cannot reach:
// that the facade wires to the real database correctly, that each
// span helper fetches enough data for its computation, and that a
// multi-month habit built through the real write path produces the
// numbers an independent calculation says it should.
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:5199/";
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `\n         ${detail}` : ""}`);
}
async function t(name, fn) {
  try {
    const note = await fn();
    record(name, true, typeof note === "string" ? note : undefined);
  } catch (err) {
    record(name, false, err?.message ?? String(err));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ── Ground truth, computed independently of the app's own date code, so
//    agreement means correctness rather than self-consistency. ─────────
const addDaysGT = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const rangeGT = (a, b) => {
  const out = [];
  for (let d = a; d <= b; d = addDaysGT(d, 1)) out.push(d);
  return out;
};

const CREATED = "2026-05-01";
const TODAY = "2026-08-14";
const MISSES = ["2026-06-15", "2026-07-04"];

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ timezoneId: "UTC" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!(window.__db && window.__logic), null, { timeout: 20000 });
  const run = (fn, arg) => page.evaluate(fn, arg);

  // ── A brand-new habit, through the real write path ─────────────────
  await t("empty habit: every function returns a defined empty shape, none throw", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-14T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "Empty", type: "boolean", frequencyType: "daily" });
      const out = {
        score: await L.getScore(db, h.id, "month"),
        scoreAll: await L.getScore(db, h.id, "all"),
        streak: await L.getCurrentStreak(db, h.id),
        best: await L.getBestStreaks(db, h.id, 5),
        trend: await L.getScoreTrend(db, h.id, "week"),
        history: await L.getHistory(db, h.id, "week"),
        heatmap: await L.getHeatmapData(db, h.id, "2026-08"),
        entries: await L.getEntriesForRange(db, h.id, "2026-08-01", "2026-08-31"),
      };
      await db.__setTestClock(null);
      return out;
    });
    assert(r.score === 0 && r.scoreAll === 0, `scores: ${r.score}/${r.scoreAll}`);
    assert(r.streak === 0, `streak: ${r.streak}`);
    assert(Array.isArray(r.best) && r.best.length === 0, "best streaks should be []");
    assert(r.trend.length < 2, `a same-day habit should yield <2 trend points, got ${r.trend.length}`);
    assert(r.history.every((b) => b.count === 0 && b.met === false), "history buckets should be empty");
    assert(r.heatmap.length === 31 && r.heatmap.every((d) => d.level === 0), "heatmap should be 31 level-0 days");
    assert(r.entries.length === 0, "entries should be []");
    assert(Object.values(r).every((v) => v !== undefined && v !== null), "no result may be undefined/null");
  });

  // ── ~3.5 months of real history: 106 days, 2 explicit misses, today
  //    deliberately left unlogged. ─────────────────────────────────────
  await t("seed 106 days of real entries through setEntry", async () => {
    const id = await run(async ({ created, today, misses }) => {
      const db = window.__db;
      await db.__setTestClock(new Date(`${created}T12:00:00Z`).getTime());
      const h = await db.createHabit({ name: "Daily", type: "boolean", frequencyType: "daily" });
      for (let d = created; d !== today; ) {
        await db.setEntry(h.id, d, misses.includes(d) ? 0 : 1);
        const dt = new Date(`${d}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + 1);
        d = dt.toISOString().slice(0, 10);
      }
      await db.__setTestClock(new Date(`${today}T12:00:00Z`).getTime());
      return h.id;
    }, { created: CREATED, today: TODAY, misses: MISSES });
    globalThis.habitId = id;
    assert(typeof id === "string" && id.length > 0, "no habit id returned");
    return `${rangeGT(CREATED, addDaysGT(TODAY, -1)).length} days written, today left unlogged`;
  });

  const currentStreakGT = rangeGT(addDaysGT("2026-07-04", 1), addDaysGT(TODAY, -1)).length;
  await t(`getCurrentStreak equals the independently-computed ${currentStreakGT}`, async () => {
    const r = await run((id) => window.__logic.getCurrentStreak(window.__db, id), globalThis.habitId);
    assert(r === currentStreakGT, `expected ${currentStreakGT}, got ${r}`);
  });

  const runLengthsGT = [
    rangeGT(CREATED, addDaysGT(MISSES[0], -1)).length,
    rangeGT(addDaysGT(MISSES[0], 1), addDaysGT(MISSES[1], -1)).length,
    currentStreakGT,
  ].sort((a, b) => b - a);
  await t(`getBestStreaks equals the independently-computed [${runLengthsGT}]`, async () => {
    const r = await run((id) => window.__logic.getBestStreaks(window.__db, id, 5), globalThis.habitId);
    assert(JSON.stringify(r.map((x) => x.length)) === JSON.stringify(runLengthsGT),
      `expected ${JSON.stringify(runLengthsGT)}, got ${JSON.stringify(r.map((x) => x.length))}`);
    assert(r[0].startDate === CREATED, `longest run should start at creation, got ${r[0].startDate}`);
    assert(r[0].endDate === addDaysGT(MISSES[0], -1), `longest run should end before the first miss, got ${r[0].endDate}`);
  });

  for (const period of ["week", "month", "all"]) {
    await t(`getScore('${period}') equals the independently-computed value`, async () => {
      const windowDays = { week: 7, month: 30, all: null }[period];
      const start = windowDays === null ? CREATED : addDaysGT(TODAY, -(windowDays - 1));
      const days = rangeGT(start < CREATED ? CREATED : start, TODAY);
      const completions = days.filter((d) => d !== TODAY && !MISSES.includes(d)).length;
      const expected = Math.round((100 * completions) / days.length);
      const r = await run(({ id, p }) => window.__logic.getScore(window.__db, id, p), { id: globalThis.habitId, p: period });
      assert(r === expected, `expected ${expected} (${completions}/${days.length}), got ${r}`);
      return `${r}% = round(100 × ${completions} ÷ ${days.length})`;
    });
  }

  await t("getScoreTrend('month') is chronological, in range, and ends today", async () => {
    const r = await run((id) => window.__logic.getScoreTrend(window.__db, id, "month"), globalThis.habitId);
    assert(r.length === 30, `expected 30 points, got ${r.length}`);
    assert(r.every((p) => p.score >= 0 && p.score <= 100), "a score fell outside 0-100");
    const dates = r.map((p) => p.date);
    assert(JSON.stringify(dates) === JSON.stringify([...dates].sort()), "points are not chronological");
    assert(r[r.length - 1].date === TODAY, `last point is ${r[r.length - 1].date}`);
  });

  await t("getHistory('week') bucket counts sum to the independently-computed total", async () => {
    const r = await run((id) => window.__logic.getHistory(window.__db, id, "week"), globalThis.habitId);
    assert(r.length === 8, `expected 8 buckets, got ${r.length}`);
    const covered = rangeGT(r[0].start, r[r.length - 1].end);
    const expected = covered.filter((d) => d !== TODAY && !MISSES.includes(d)).length;
    const total = r.reduce((s, b) => s + b.count, 0);
    assert(total === expected, `expected ${expected} completions across buckets, got ${total}`);
    return `${total} completions across ${r.length} buckets (${r[0].start} → ${r[r.length - 1].end})`;
  });

  await t("getHeatmapData('2026-08') grades the month and keeps future days at 0", async () => {
    const r = await run((id) => window.__logic.getHeatmapData(window.__db, id, "2026-08"), globalThis.habitId);
    assert(r.length === 31, `expected 31 days, got ${r.length}`);
    assert(r.every((d) => d.level >= 0 && d.level <= 4), "a level fell outside 0-4");
    assert(r.find((d) => d.date === TODAY).level >= 3, "today's trailing week is near-perfect and should rank high");
    assert(r.filter((d) => d.date > TODAY).every((d) => d.level === 0), "future days must stay at level 0");
  });

  // ── The N+1 fix: a chart must cost a constant number of statements ──
  await t("a trend render costs a constant number of statements, not one per point", async () => {
    const r = await run(async (id) => {
      const db = window.__db, L = window.__logic;
      await db.__resetStatementCount();
      const points = await L.getScoreTrend(db, id, "month");
      const trend = await db.__getStatementCount();
      await db.__resetStatementCount();
      await L.getHeatmapData(db, id, "2026-08");
      const heatmap = await db.__getStatementCount();
      return { points: points.length, trend, heatmap };
    }, globalThis.habitId);
    // getHabit + getToday(→ getDayStartHour) + one entry fetch.
    assert(r.trend <= 5, `${r.points}-point trend used ${r.trend} statements — it is querying per point`);
    assert(r.heatmap <= 5, `heatmap used ${r.heatmap} statements — it is querying per day`);
    return `${r.points}-point trend: ${r.trend} statements; 31-day heatmap: ${r.heatmap} statements`;
  });

  // ── Boundary streaks on dedicated habits ───────────────────────────
  await t("a streak spanning a month boundary is one run of 12", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-20T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "MonthEdge", type: "boolean", frequencyType: "daily" });
      for (let d = "2026-08-25"; d <= "2026-09-05"; ) {
        await db.setEntry(h.id, d, 1);
        const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + 1);
        d = dt.toISOString().slice(0, 10);
      }
      await db.__setTestClock(new Date("2026-09-05T12:00:00Z").getTime());
      const out = { best: await L.getBestStreaks(db, h.id, 5), current: await L.getCurrentStreak(db, h.id) };
      await db.__setTestClock(null);
      return out;
    });
    assert(r.best.length === 1 && r.best[0].length === 12, `got ${JSON.stringify(r.best)}`);
    assert(r.best[0].startDate === "2026-08-25" && r.best[0].endDate === "2026-09-05", "wrong bounds");
    assert(r.current === 12, `current streak should also be 12, got ${r.current}`);
  });

  await t("a streak spanning a year boundary is one run of 22, and expires afterwards", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2025-12-15T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "YearEdge", type: "boolean", frequencyType: "daily" });
      for (let d = "2025-12-20"; d <= "2026-01-10"; ) {
        await db.setEntry(h.id, d, 1);
        const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + 1);
        d = dt.toISOString().slice(0, 10);
      }
      await db.__setTestClock(new Date("2026-01-20T12:00:00Z").getTime());
      const out = { best: await L.getBestStreaks(db, h.id, 5), current: await L.getCurrentStreak(db, h.id) };
      await db.__setTestClock(null);
      return out;
    });
    assert(r.best.length === 1 && r.best[0].length === 22, `got ${JSON.stringify(r.best)}`);
    assert(r.best[0].startDate === "2025-12-20" && r.best[0].endDate === "2026-01-10", "wrong bounds");
    assert(r.current === 0, `the run ended 10 days before "today", so current should be 0, got ${r.current}`);
  });

  // ── Non-daily frequencies, end to end ──────────────────────────────
  await t("a Mon/Wed/Fri habit scores only against its scheduled days", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-01T12:00:00Z").getTime());
      const h = await db.createHabit({
        name: "MWF", type: "boolean", frequencyType: "specific_days", frequencyDays: [1, 3, 5],
      });
      for (const d of ["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-10", "2026-08-12", "2026-08-14"]) {
        await db.setEntry(h.id, d, 1);
      }
      await db.__setTestClock(new Date("2026-08-14T12:00:00Z").getTime());
      const out = { score: await L.getScore(db, h.id, "month"), streak: await L.getCurrentStreak(db, h.id) };
      await db.__setTestClock(null);
      return out;
    });
    assert(r.score === 100, `all 6 scheduled days were completed, expected 100, got ${r.score}`);
    assert(r.streak === 6, `weekends must not break the streak, expected 6, got ${r.streak}`);
    return "weekends neither counted against the score nor broke the streak";
  });

  await t("a numeric at_least habit counts only days meeting target", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-01T12:00:00Z").getTime());
      const h = await db.createHabit({
        name: "Water", type: "numeric", target: 8, unit: "glasses", frequencyType: "daily",
      });
      await L.setEntry(db, h.id, "2026-08-01", 8);
      await L.setEntry(db, h.id, "2026-08-02", 10);
      await L.setEntry(db, h.id, "2026-08-03", 5);
      await db.__setTestClock(new Date("2026-08-03T12:00:00Z").getTime());
      const score = await L.getScore(db, h.id, "all");
      await db.__setTestClock(null);
      return score;
    });
    assert(r === 67, `expected round(100 × 2 ÷ 3) = 67, got ${r}`);
  });

  await t("a numeric at_most habit treats a low value as success", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-01T12:00:00Z").getTime());
      const h = await db.createHabit({
        name: "Scrolling", type: "numeric", target: 30, unit: "min",
        targetDirection: "at_most", frequencyType: "daily",
      });
      await L.setEntry(db, h.id, "2026-08-01", 10);
      await L.setEntry(db, h.id, "2026-08-02", 0);
      await L.setEntry(db, h.id, "2026-08-03", 90);
      await db.__setTestClock(new Date("2026-08-03T12:00:00Z").getTime());
      const score = await L.getScore(db, h.id, "all");
      await db.__setTestClock(null);
      return score;
    });
    assert(r === 67, `10 and 0 minutes are both under the 30-minute cap, expected 67, got ${r}`);
  });

  await t("toggleEntry drives the full tri-state cycle through the real database", async () => {
    const r = await run(async () => {
      const db = window.__db, L = window.__logic;
      const h = await db.createHabit({ name: "Toggle", type: "boolean", frequencyType: "daily" });
      const seen = [];
      for (let i = 0; i < 4; i++) {
        const e = await db.getEntry(h.id, "2026-07-01");
        seen.push(e === null ? "none" : String(e.value));
        await L.toggleEntry(db, h.id, "2026-07-01");
      }
      return seen;
    });
    assert(JSON.stringify(r) === JSON.stringify(["none", "1", "0", "none"]), JSON.stringify(r));
    return r.join(" → ");
  });

  assert(errors.length === 0, `console errors: ${errors.join("; ")}`);
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
