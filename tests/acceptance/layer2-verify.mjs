// Layer 2 (Logic) verification, per spec §6 gate 2: every function
// exercised against a habit with real multi-month historical entries,
// including empty cases and streak correctness across month/year
// boundaries. Runs against the real Worker+OPFS stack (nothing mocked),
// via window.__db / window.__logic exposed by src/main.ts.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:5199/";
const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? " — " + detail : ""}`); }
async function t(name, fn) {
  try { const d = await fn(); record(name, true, typeof d === "string" ? d : undefined); }
  catch (err) { record(name, false, err?.stack || String(err)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ── Independent ("ground truth") date helpers — deliberately NOT reusing
// the app's own dateUtil.ts, so this is a genuine external check rather
// than "does the code agree with itself". ─────────────────────────────
function addDaysGT(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function rangeGT(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDaysGT(d, 1)) out.push(d);
  return out;
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ timezoneId: "UTC" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!(window.__db && window.__logic), null, { timeout: 15000 });

  // ── Pure function: getScoreColor boundaries (no DB involved) ────────
  await t("getScoreColor: 0/39/40/69/70/100 boundaries", async () => {
    const r = await page.evaluate(() => {
      const f = window.__logic.getScoreColor;
      return [0, 39, 40, 69, 70, 100].map(f);
    });
    assert(JSON.stringify(r) === JSON.stringify(["danger-red", "danger-red", "accent-gold", "accent-gold", "success-green", "success-green"]), JSON.stringify(r));
  });

  // ── Empty-case habit: zero entries, created "today" ──────────────
  await t("empty habit: getScore/getCurrentStreak/getBestStreaks/getScoreTrend/getHistory never throw or return undefined", async () => {
    const r = await page.evaluate(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-14T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "Empty", type: "boolean", frequencyType: "daily" });
      const score = await L.getScore(db, h.id, "month");
      const streak = await L.getCurrentStreak(db, h.id);
      const best = await L.getBestStreaks(db, h.id, 5);
      const trend = await L.getScoreTrend(db, h.id, "week");
      const history = await L.getHistory(db, h.id, "week");
      const heatmap = await L.getHeatmapData(db, h.id, "2026-08");
      await db.__setTestClock(null);
      return { score, streak, best, trendLen: trend.length, history, heatmapLen: heatmap.length, heatmapAllZero: heatmap.every((d) => d.level === 0) };
    });
    assert(r.score === 0, `expected score 0, got ${r.score}`);
    assert(r.streak === 0, `expected streak 0, got ${r.streak}`);
    assert(Array.isArray(r.best) && r.best.length === 0, `expected [], got ${JSON.stringify(r.best)}`);
    assert(r.trendLen < 2, `expected <2 trend points for a same-day habit, got ${r.trendLen}`);
    assert(Array.isArray(r.history) && r.history.every((b) => b.count === 0 && b.met === false), `expected all-zero history buckets, got ${JSON.stringify(r.history)}`);
    assert(r.heatmapLen === 31, `expected 31 days for August, got ${r.heatmapLen}`);
    assert(r.heatmapAllZero, "expected every heatmap day at level 0 for a zero-entry habit");
  });

  // ── Main scenario: daily boolean habit, ~106 days, 2 explicit misses,
  //    today left unlogged (tests the "today in progress" streak rule) ─
  const CREATED = "2026-05-01";
  const TODAY = "2026-08-14";
  const MISSES = new Set(["2026-06-15", "2026-07-04"]);

  await t("seed a ~3.5-month daily boolean habit with 2 misses, today unlogged", async () => {
    const r = await page.evaluate(async ({ created, today, misses }) => {
      const db = window.__db;
      await db.__setTestClock(new Date(`${created}T12:00:00Z`).getTime());
      const h = await db.createHabit({ name: "Daily 106d", type: "boolean", frequencyType: "daily" });
      // Walk day by day, logging every day except the misses and today.
      let d = created;
      while (d !== today) {
        await db.setEntry(h.id, d, misses.includes(d) ? 0 : 1);
        const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + 1);
        d = dt.toISOString().slice(0, 10);
      }
      // today (TODAY) intentionally left unlogged.
      await db.__setTestClock(new Date(`${today}T12:00:00Z`).getTime());
      return h.id;
    }, { created: CREATED, today: TODAY, misses: [...MISSES] });
    assert(typeof r === "string" && r.length > 0, "expected a habit id back");
    global.__dailyHabitId = r;
  });

  // Ground-truth current streak: every day from the day after the last
  // miss (2026-07-04) through the day before today, all completed.
  const expectedCurrentStreak = rangeGT(addDaysGT("2026-07-04", 1), addDaysGT(TODAY, -1)).length;
  await t(`getCurrentStreak matches ground truth (${expectedCurrentStreak})`, async () => {
    const r = await page.evaluate((id) => window.__logic.getCurrentStreak(window.__db, id), global.__dailyHabitId);
    assert(r === expectedCurrentStreak, `expected ${expectedCurrentStreak}, got ${r}`);
  });

  const run1 = rangeGT(CREATED, addDaysGT("2026-06-15", -1)).length; // created .. day before first miss
  const run2 = rangeGT(addDaysGT("2026-06-15", 1), addDaysGT("2026-07-04", -1)).length; // between misses
  const run3 = expectedCurrentStreak; // after 2nd miss .. day before today
  await t(`getBestStreaks matches ground truth (${run1}, ${run3}, ${run2} longest-first)`, async () => {
    const r = await page.evaluate((id) => window.__logic.getBestStreaks(window.__db, id, 5), global.__dailyHabitId);
    assert(r.length === 3, `expected 3 runs, got ${r.length}: ${JSON.stringify(r)}`);
    const lengths = r.map((x) => x.length);
    assert(JSON.stringify(lengths) === JSON.stringify([run1, run3, run2].sort((a, b) => b - a)), `expected lengths sorted desc from {${run1},${run2},${run3}}, got ${JSON.stringify(lengths)}`);
    assert(r[0].startDate === CREATED, `longest run should start at habit creation (${CREATED}), got ${r[0].startDate}`);
  });

  // Ground-truth month score: trailing 30 days ending TODAY.
  await t("getScore('month') matches ground truth", async () => {
    const start = addDaysGT(TODAY, -29);
    const days = rangeGT(start, TODAY);
    const completions = days.filter((d) => d !== TODAY && !MISSES.has(d)).length; // today unlogged, no misses in this window
    const expected = Math.round((100 * completions) / days.length);
    const r = await page.evaluate((id) => window.__logic.getScore(window.__db, id, "month"), global.__dailyHabitId);
    assert(r === expected, `expected ${expected}, got ${r}`);
  });

  await t("getScore('all') matches ground truth", async () => {
    const days = rangeGT(CREATED, TODAY);
    const completions = days.filter((d) => d !== TODAY && !MISSES.has(d)).length;
    const expected = Math.round((100 * completions) / days.length);
    const r = await page.evaluate((id) => window.__logic.getScore(window.__db, id, "all"), global.__dailyHabitId);
    assert(r === expected, `expected ${expected}, got ${r}`);
  });

  await t("getScoreTrend('month') returns ~30 points, values in [0,100], monotonic dates", async () => {
    const r = await page.evaluate((id) => window.__logic.getScoreTrend(window.__db, id, "month"), global.__dailyHabitId);
    assert(r.length >= 25 && r.length <= 30, `unexpected point count ${r.length}`);
    assert(r.every((p) => p.score >= 0 && p.score <= 100), "score out of [0,100] range");
    const dates = r.map((p) => p.date);
    assert(JSON.stringify(dates) === JSON.stringify([...dates].sort()), "trend points not in chronological order");
    assert(r[r.length - 1].date === TODAY, `last point should be today, got ${r[r.length - 1].date}`);
  });

  await t("getHistory('week') buckets sum of counts equals total completions in covered range", async () => {
    const r = await page.evaluate((id) => window.__logic.getHistory(window.__db, id, "week"), global.__dailyHabitId);
    assert(r.length > 0 && r.length <= 8, `unexpected bucket count ${r.length}`);
    const totalCount = r.reduce((s, b) => s + b.count, 0);
    const coveredDays = rangeGT(r[0].start, r[r.length - 1].end);
    const expectedTotal = coveredDays.filter((d) => d !== TODAY && !MISSES.has(d)).length;
    assert(totalCount === expectedTotal, `expected ${expectedTotal} total completions across buckets, got ${totalCount}`);
    for (const b of r) assert(b.met === (Math.round((100 * b.count) / rangeGT(b.start, b.end).length) >= 70), `bucket ${b.start}..${b.end} met flag inconsistent with its own score`);
  });

  await t("getHeatmapData('2026-08') has 31 days, today's window reflects near-perfect recent completion", async () => {
    const r = await page.evaluate((id) => window.__logic.getHeatmapData(window.__db, id, "2026-08"), global.__dailyHabitId);
    assert(r.length === 31, `expected 31 days, got ${r.length}`);
    const todayEntry = r.find((d) => d.date === TODAY);
    assert(todayEntry.level >= 3, `expected a high level for today's trailing week (only today itself unlogged), got ${todayEntry.level}`);
    const future = r.find((d) => d.date === "2026-08-20");
    assert(future.level === 0, `expected level 0 for a future date, got ${future.level}`);
  });

  // ── Month + year boundary streaks, on dedicated habits ───────────
  await t("streak correctness across a MONTH boundary (Aug25-Sep05, length 12)", async () => {
    const r = await page.evaluate(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-20T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "Month boundary streak", type: "boolean", frequencyType: "daily" });
      for (const d of ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31",
        "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]) {
        await db.setEntry(h.id, d, 1);
      }
      await db.__setTestClock(new Date("2026-09-10T12:00:00Z").getTime());
      const best = await L.getBestStreaks(db, h.id, 5);
      await db.__setTestClock(null);
      return best;
    });
    assert(r.length === 1, `expected 1 run, got ${JSON.stringify(r)}`);
    assert(r[0].length === 12, `expected length 12, got ${r[0].length}`);
    assert(r[0].startDate === "2026-08-25" && r[0].endDate === "2026-09-05", `wrong bounds: ${JSON.stringify(r[0])}`);
  });

  await t("streak correctness across a YEAR boundary (Dec20-Jan10, length 22)", async () => {
    const r = await page.evaluate(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2025-12-15T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "Year boundary streak", type: "boolean", frequencyType: "daily" });
      let d = "2025-12-20";
      while (d !== "2026-01-11") {
        await db.setEntry(h.id, d, 1);
        const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + 1);
        d = dt.toISOString().slice(0, 10);
      }
      await db.__setTestClock(new Date("2026-01-20T12:00:00Z").getTime());
      const best = await L.getBestStreaks(db, h.id, 5);
      const streak = await L.getCurrentStreak(db, h.id); // should be 0 now — the run ended 10 days ago
      await db.__setTestClock(null);
      return { best, streak };
    });
    assert(r.best.length === 1, `expected 1 run, got ${JSON.stringify(r.best)}`);
    assert(r.best[0].length === 22, `expected length 22, got ${r.best[0].length}`);
    assert(r.best[0].startDate === "2025-12-20" && r.best[0].endDate === "2026-01-10", `wrong bounds: ${JSON.stringify(r.best[0])}`);
    assert(r.streak === 0, `expected current streak 0 (run ended 10 days before "today"), got ${r.streak}`);
  });

  // ── specific_days habit: scheduledDays must ignore non-scheduled days ─
  await t("specific_days habit (Mon/Wed/Fri): score ignores non-scheduled days entirely", async () => {
    const r = await page.evaluate(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-01T12:00:00Z").getTime()); // a Saturday
      const h = await db.createHabit({ name: "MWF", type: "boolean", frequencyType: "specific_days", frequencyDays: [1, 3, 5] });
      // Complete every Mon/Wed/Fri in [Aug 1, Aug 14]; log nothing else.
      for (const d of ["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-10", "2026-08-12", "2026-08-14"]) {
        await db.setEntry(h.id, d, 1);
      }
      await db.__setTestClock(new Date("2026-08-14T12:00:00Z").getTime());
      const score = await L.getScore(db, h.id, "month");
      await db.__setTestClock(null);
      return score;
    });
    // Trailing 30 days clamps to createdDate 2026-08-01 (14 days: Aug1-14).
    // Scheduled Mon/Wed/Fri in that window: 3,5,7,10,12,14 = 6 days, all completed.
    assert(r === 100, `expected 100 (all 6 scheduled MWF days completed), got ${r}`);
  });

  // ── numeric habit: at_least / at_most target completion ──────────
  await t("numeric habit (at_least target): only entries meeting target count", async () => {
    const r = await page.evaluate(async () => {
      const db = window.__db, L = window.__logic;
      await db.__setTestClock(new Date("2026-08-01T12:00:00Z").getTime());
      const h = await db.createHabit({ name: "Water", type: "numeric", target: 8, unit: "glasses", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-08-01", 8); // meets
      await db.setEntry(h.id, "2026-08-02", 10); // meets
      await db.setEntry(h.id, "2026-08-03", 5); // below target
      await db.__setTestClock(new Date("2026-08-03T12:00:00Z").getTime());
      const score = await L.getScore(db, h.id, "all"); // 3 scheduled days, 2 meet
      await db.__setTestClock(null);
      return score;
    });
    assert(r === 67, `expected round(100*2/3)=67, got ${r}`);
  });

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (pageErrors.length) { console.log("PAGE ERRORS:", pageErrors.join("; ")); process.exitCode = 1; }
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
