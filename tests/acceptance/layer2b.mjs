// Layer 2b §9 tests 15-24 — the batched reads, the cache, and the XP
// surface, against the real database in a real browser.
//
// Test 18 (export_roundtrips) lives in backup.mjs, beside the rest of the
// import/export guarantees it belongs with.
//
// Two things here are measured rather than asserted from the source. The
// batching tests count statements the repository actually executed, so
// "this is one query" is a fact about the running code and not a claim
// about how it reads. The cache tests compare cached answers against
// answers computed from a cache that was never populated, so a stale
// value fails on its own numbers.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5199/Gym-/";
const FAKE = process.env.FAKE_SUPABASE || "http://localhost:5299";
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

const control = (body) =>
  fetch(`${FAKE}/__control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());

async function withApp(fn, { sync = null } = {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "layer2b-"));
  const ctx = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => !!window.__db && !!window.__logic, null, { timeout: 30000 });
    if (sync) {
      await page.evaluate(
        ([url, uid]) => window.__db.__configureSync({
          url, apiKey: "fake-anon-key", accessToken: uid, userId: uid, schema: "habits",
        }),
        [FAKE, sync],
      );
    }
    return await fn(page);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The clock is pinned so "today" is a known Wednesday, 2026-08-19. Every
 * expectation below is written against that date; without it the suite
 * would pass or fail depending on the day it ran.
 *
 * A pinned clock is FROZEN, not merely offset: every updated_at written
 * while it holds is identical. Test 23 has to move it deliberately,
 * because a watermark over rows that all share one timestamp proves
 * nothing.
 */
const PIN = `async () => {
  await window.__db.__setTestClock(Date.parse("2026-08-19T12:00:00Z"));
}`;

async function main() {
  await t("15. scheduled_habits_for_date_correct — only habits due that day, quota habits always", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const daily = await db.createHabit({ name: "Daily", type: "boolean", frequencyType: "daily" });
      // Wed = 3. This one is due on the pinned day; the next is not.
      const wed = await db.createHabit({
        name: "Wed only", type: "boolean", frequencyType: "specific_days", frequencyDays: [3],
      });
      const tue = await db.createHabit({
        name: "Tue only", type: "boolean", frequencyType: "specific_days", frequencyDays: [2],
      });
      const quota = await db.createHabit({
        name: "3x week", type: "boolean", frequencyType: "times_per_week", frequencyCount: 3,
      });
      const archived = await db.createHabit({ name: "Archived", type: "boolean", frequencyType: "daily" });
      await db.archiveHabit(archived.id);

      const due = await L.getScheduledHabitsForDate(db, "2026-08-19");
      return {
        names: due.map((d) => d.habit.name).sort(),
        shapes: Object.fromEntries(due.map((d) => [d.habit.name, d.shape])),
        // A quota habit must not be handed a per-day due boolean (§2.2).
        quotaDue: due.find((d) => d.habit.name === "3x week")?.due,
        quotaState: due.find((d) => d.habit.name === "3x week")?.quota,
        ids: { daily: daily.id, wed: wed.id, tue: tue.id, quota: quota.id },
      };
    }, PIN));

    assert(JSON.stringify(r.names) === JSON.stringify(["3x week", "Daily", "Wed only"]),
      `due on a Wednesday: ${JSON.stringify(r.names)}`);
    assert(r.quotaDue === null, `the quota habit was given a due boolean: ${r.quotaDue}`);
    assert(r.quotaState && r.quotaState.required === 3,
      `the quota habit came back without its quota state: ${JSON.stringify(r.quotaState)}`);
    return `Daily and Wed only were due; Tue only and the archived habit were not; 3x week reported ${r.quotaState.completed}/3`;
  });

  await t("16. completions_for_date_is_batched — one entry query regardless of habit count", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const count = async (n) => {
        // A fresh database per measurement would be cleaner but slower;
        // instead the count is taken for n habits, then for n+15 in the
        // same database, and only the DIFFERENCE is asserted on.
        await db.__resetStatementCount();
        await L.getCompletionsForDate(db, "2026-08-19");
        return db.__getStatementCount();
      };
      const make = async (n, tag) => {
        for (let i = 0; i < n; i++) {
          await db.createHabit({ name: `${tag}-${i}`, type: "boolean", frequencyType: "daily" });
        }
      };
      await make(3, "a");
      const three = await count();
      await make(17, "b");
      const twenty = await count();
      const rows = await L.getCompletionsForDate(db, "2026-08-19");
      return { three, twenty, rows: rows.length };
    }, PIN));

    assert(r.rows === 20, `the read returned ${r.rows} habits, expected 20`);
    assert(r.twenty === r.three,
      `3 habits cost ${r.three} statements, 20 cost ${r.twenty} — the read is per-habit, not batched`);
    return `${r.three} statements for 3 habits, ${r.twenty} for 20 — flat`;
  });

  await t("17. habits_summary_is_batched — score, streak and best streak for every habit in one read", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const seed = async (n, tag) => {
        for (let i = 0; i < n; i++) {
          const h = await db.createHabit({ name: `${tag}-${i}`, type: "boolean", frequencyType: "daily" });
          // History, so the summary has real work to do rather than
          // short-circuiting on an empty habit.
          for (const d of ["2026-08-15", "2026-08-16", "2026-08-17"]) await db.setEntry(h.id, d, 1);
        }
      };
      const count = async () => {
        await db.__resetStatementCount();
        await L.getHabitsSummary(db, "month");
        return db.__getStatementCount();
      };
      await seed(3, "a");
      const three = await count();
      await seed(17, "b");
      const twenty = await count();
      const summary = await L.getHabitsSummary(db, "month");
      return {
        three, twenty,
        rows: summary.length,
        sample: summary[0] && {
          score: summary[0].score, current: summary[0].currentStreak, best: summary[0].bestStreak,
        },
      };
    }, PIN));

    assert(r.rows === 20, `the summary returned ${r.rows} rows, expected 20`);
    assert(r.twenty === r.three,
      `3 habits cost ${r.three} statements, 20 cost ${r.twenty} — the summary queries per habit`);
    assert(r.sample && r.sample.best === 3,
      `the summary lost its arithmetic while being batched: ${JSON.stringify(r.sample)}`);
    return `${r.three} statements for 3 habits, ${r.twenty} for 20; best streak still ${r.sample.best}`;
  });

  console.log("18. export_roundtrips — covered in backup.mjs, beside the rest of import/export.");

  await t("19. cache_invalidates_on_write — a logged day changes the streak on the next read", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const h = await db.createHabit({ name: "Cached", type: "boolean", frequencyType: "daily" });
      for (const d of ["2026-08-17", "2026-08-18"]) await db.setEntry(h.id, d, 1);

      const first = await L.getCurrentStreak(db, h.id);
      L.cache.__resetStats();
      const cached = await L.getCurrentStreak(db, h.id);
      const hitStats = L.cache.stats();

      // A write to THIS habit must invalidate it...
      await db.setEntry(h.id, "2026-08-19", 1);
      const afterWrite = await L.getCurrentStreak(db, h.id);

      // ...and a write to a DIFFERENT habit must not, or the cache is
      // just a very expensive way of computing everything twice.
      const other = await db.createHabit({ name: "Unrelated", type: "boolean", frequencyType: "daily" });
      await db.setEntry(other.id, "2026-08-19", 1);
      L.cache.__resetStats();
      const afterUnrelated = await L.getCurrentStreak(db, h.id);
      const unrelatedStats = L.cache.stats();

      return { first, cached, hitStats, afterWrite, afterUnrelated, unrelatedStats };
    }, PIN));

    assert(r.first === 2, `the streak started at ${r.first}, expected 2`);
    assert(r.cached === 2 && r.hitStats.hits === 1,
      `the second read was not served from cache: ${JSON.stringify(r.hitStats)}`);
    assert(r.afterWrite === 3, `the streak stayed at ${r.afterWrite} after logging today — stale`);
    assert(r.afterUnrelated === 3, `an unrelated write corrupted the answer: ${r.afterUnrelated}`);
    assert(r.unrelatedStats.hits === 1,
      `an unrelated habit's write dropped this habit's entry: ${JSON.stringify(r.unrelatedStats)}`);
    return "2 → cached → 3 after its own write; an unrelated write kept the hit";
  });

  await t("20. cache_invalidates_on_sync_pull — rows arriving from the server drop the cache", async () => {
    await control({ reset: true });
    // Device A builds two days of history and pushes it.
    const habitId = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db;
      await (eval(pin))();
      const h = await db.createHabit({ name: "Shared", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-08-18", 1);
      await db.__syncNow();
      return h.id;
    }, PIN), { sync: "user-a" });

    const r = await withApp(async (page) => page.evaluate(async ([pin, id, fake]) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      await db.__syncNow();
      const before = await L.getCurrentStreak(db, id);

      // The change is made on the server, so the local write counter for
      // this habit never moves. Only the pull announcement can save the
      // cache here — which is the entire point of the test.
      await fetch(`${fake}/rest/v1/entries`, {
        method: "POST",
        headers: {
          apikey: "fake-anon-key", Authorization: "Bearer user-a",
          "Content-Type": "application/json", "Content-Profile": "habits",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([{
          id: "remote-entry-1", habit_id: id, user_id: "user-a", date: "2026-08-19", value: 1,
          // Later than the high-water mark the first pull just wrote, or
          // the next pull would filter this row straight back out.
          note: null, created_at: "2026-08-19T23:00:00.000Z", updated_at: "2026-08-19T23:00:00.000Z",
          deleted_at: null,
        }]),
      });

      const run = await db.__syncNow();
      const after = await L.getCurrentStreak(db, id);
      // What the answer would be with no cache at all, computed the long
      // way round: the assertion is against the data, not against itself.
      L.cache.clear();
      const truth = await L.getCurrentStreak(db, id);
      return { before, run, after, truth, stored: (await db.getEntry(id, "2026-08-19"))?.value ?? null };
    }, [PIN, habitId, FAKE]), { sync: "user-a" });

    assert(r.stored === 1, `the remote entry never landed locally: ${JSON.stringify(r.run)}`);
    assert(r.before === 1, `device B started at ${r.before}, expected 1`);
    assert(r.truth === 2, `the uncached answer is ${r.truth}, so the test data is wrong`);
    assert(r.after === r.truth,
      `after a pull the cache served ${r.after} where the data says ${r.truth} — the pull did not invalidate`);
    return `pulled ${r.run.pulled} row(s); the streak moved 1 → ${r.after} without a local write`;
  });

  await t("21. cache_never_serves_stale_streak — a write during a computation is not overwritten", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const h = await db.createHabit({ name: "Racy", type: "boolean", frequencyType: "daily" });
      for (const d of ["2026-08-17", "2026-08-18"]) await db.setEntry(h.id, d, 1);

      // Start the read, then land a write before it can finish. If the
      // finished computation is stored under the version it started
      // from, the next read serves 2 forever.
      const reading = L.getCurrentStreak(db, h.id);
      const writing = db.setEntry(h.id, "2026-08-19", 1);
      const [duringRace] = await Promise.all([reading, writing]);
      const next = await L.getCurrentStreak(db, h.id);

      L.cache.clear();
      const truth = await L.getCurrentStreak(db, h.id);

      // The same race in the other order, repeated, because a race that
      // only sometimes loses is still a bug.
      let worstCase = null;
      for (let i = 0; i < 5; i++) {
        const date = `2026-08-${20 + i}`;
        const r2 = L.getCurrentStreak(db, h.id);
        await db.setEntry(h.id, date, 1);
        await r2;
        const seen = await L.getCurrentStreak(db, h.id);
        L.cache.clear();
        const expected = await L.getCurrentStreak(db, h.id);
        if (seen !== expected) worstCase = { i, date, seen, expected };
      }
      return { duringRace, next, truth, worstCase };
    }, PIN));

    assert(r.truth === 3, `the uncached answer is ${r.truth}, expected 3`);
    assert(r.next === r.truth,
      `the read that raced a write was cached: got ${r.next}, the data says ${r.truth}`);
    assert(r.worstCase === null,
      `a stale streak was served: ${JSON.stringify(r.worstCase)}`);
    // The in-flight read itself may legitimately return either value —
    // it was answering a question about a database that was changing.
    // What may never happen is that answer outliving the write.
    return `the racing read returned ${r.duringRace}; every subsequent read matched the data (5 further races, none stale)`;
  });

  await t("22. streak_at_date_is_historical — a backfilled day is worth what that day was worth", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const h = await db.createHabit({ name: "Backfill", type: "boolean", frequencyType: "daily" });
      // A long run this week, and one isolated day a fortnight ago.
      for (const d of ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"]) {
        await db.setEntry(h.id, d, 1);
      }
      await db.setEntry(h.id, "2026-08-05", 1);
      return {
        today: await L.getStreakAtDate(db, h.id, "2026-08-19"),
        midRun: await L.getStreakAtDate(db, h.id, "2026-08-17"),
        isolated: await L.getStreakAtDate(db, h.id, "2026-08-05"),
        beforeAnything: await L.getStreakAtDate(db, h.id, "2026-07-01"),
        live: await L.getCurrentStreak(db, h.id),
      };
    }, PIN));

    assert(r.today === 5, `today's streak is ${r.today}, expected 5`);
    assert(r.midRun === 3, `the streak on the 17th was ${r.midRun}, expected 3 — it used today's`);
    assert(r.isolated === 1, `the isolated day scored ${r.isolated}, expected 1`);
    assert(r.beforeAnything === 0, `a date before the habit existed scored ${r.beforeAnything}`);
    return `5 today, 3 on the 17th, 1 on the 5th — each date judged as it stood`;
  });

  await t("23. completions_since_watermark — only entries touched after the mark come back", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const h = await db.createHabit({ name: "Ingested", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-08-17", 1);
      await db.setEntry(h.id, "2026-08-18", 1);

      const all = await L.getCompletionsSince(db, null);
      const mark = all[all.length - 1].updatedAt;
      const nothingNew = await L.getCompletionsSince(db, mark);

      // The clock moves on, still on the same calendar day, so the next
      // writes carry a genuinely later updated_at. Under the frozen test
      // clock they would otherwise tie with the mark and be filtered out
      // — an artefact of the harness, not of the watermark.
      await db.__setTestClock(Date.parse("2026-08-19T13:00:00Z"));

      // A new write, and an edit to a row that was already ingested:
      // both have to come back, or XP silently misses corrections.
      await db.setEntry(h.id, "2026-08-19", 1);
      await db.setEntry(h.id, "2026-08-17", 0);
      const since = await L.getCompletionsSince(db, mark);

      return {
        all: all.length,
        nothingNew: nothingNew.length,
        since: since.map((c) => ({ date: c.date, completed: c.completed, streak: c.streakAtDate })),
        ordered: since.every((c, i) => i === 0 || since[i - 1].updatedAt <= c.updatedAt),
      };
    }, PIN));

    assert(r.all === 2, `the first ingest saw ${r.all} rows, expected 2`);
    assert(r.nothingNew === 0, `re-running at the mark returned ${r.nothingNew} rows — XP would double-count`);
    assert(r.since.length === 2, `the incremental ingest saw ${r.since.length} rows, expected 2`);
    const edited = r.since.find((c) => c.date === "2026-08-17");
    assert(edited && edited.completed === false,
      `the corrected day did not come back as incomplete: ${JSON.stringify(edited)}`);
    assert(r.ordered, "rows were not ordered by updatedAt, so a watermark cannot be taken from the last one");
    return `2 rows at first; 0 at the mark; 2 after a write and a correction, in updatedAt order`;
  });

  await t("24. completed_flag_is_direction_aware — under an at_most target counts as done", async () => {
    const r = await withApp(async (page) => page.evaluate(async (pin) => {
      const db = window.__db, L = window.__logic;
      await (eval(pin))();
      const under = await db.createHabit({
        name: "Coffee", type: "numeric", unit: "cups", target: 2,
        targetDirection: "at_most", frequencyType: "daily",
      });
      const over = await db.createHabit({
        name: "Water", type: "numeric", unit: "L", target: 2,
        targetDirection: "at_least", frequencyType: "daily",
      });
      await db.setEntry(under.id, "2026-08-19", 1);   // 1 ≤ 2 → done
      await db.setEntry(over.id, "2026-08-19", 1);    // 1 < 2 → not done
      await db.setEntry(under.id, "2026-08-18", 5);   // 5 > 2 → not done
      await db.setEntry(over.id, "2026-08-18", 5);    // 5 ≥ 2 → done

      const rows = await L.getCompletionsSince(db, null);
      const flag = (name, date) =>
        rows.find((c) => c.habitName === name && c.date === date)?.completed;
      const day = await L.getCompletionsForDate(db, "2026-08-19");
      return {
        underLow: flag("Coffee", "2026-08-19"),
        underHigh: flag("Coffee", "2026-08-18"),
        overLow: flag("Water", "2026-08-19"),
        overHigh: flag("Water", "2026-08-18"),
        // The same rule has to hold on the day read, not just the XP feed.
        dayView: Object.fromEntries(day.map((d) => [d.habit.name, d.completed])),
        // §4.3: an at_most habit has no "mark as missed" — a zero is a
        // perfect day, so the tri-state cycle would be lying.
        missAllowed: {
          under: L.allowsExplicitMiss(await db.getHabit(under.id)),
          over: L.allowsExplicitMiss(await db.getHabit(over.id)),
        },
      };
    }, PIN));

    assert(r.underLow === true, "1 cup under a 2-cup limit was not counted as done");
    assert(r.underHigh === false, "5 cups over a 2-cup limit was counted as done");
    assert(r.overLow === false, "1L against a 2L goal was counted as done");
    assert(r.overHigh === true, "5L against a 2L goal was not counted as done");
    assert(r.dayView.Coffee === true && r.dayView.Water === false,
      `the day view disagrees with the XP feed: ${JSON.stringify(r.dayView)}`);
    assert(r.missAllowed.under === false && r.missAllowed.over === true,
      `explicit-miss rule is wrong: ${JSON.stringify(r.missAllowed)}`);
    return "at_most done below the limit, at_least done above it, on both surfaces";
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
