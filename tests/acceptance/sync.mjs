// Layer 1b §9.2 / §9.3 — offline behaviour and the sync engine.
//
// Runs the real app in a real browser against tests/fake-supabase.mjs, a
// PostgREST-shaped server that can be told to fail on demand. What is
// under test here is the client: queue ordering, atomicity of a mutation
// and its queue row, last-write-wins, tombstones that stay dead, and a
// high-water mark that does not advance through a failure.
//
// Tests 17-22 (§9.4 — RLS, the Kahiro view, the RPC) are NOT here. They
// need real Postgres and two real accounts; asserting them against a fake
// would prove nothing about the thing being claimed. supabase/schema.sql
// carries the SQL those tests are for.
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

/** A profile no browser has ever used, so each test starts from nothing. */
async function withApp(fn, { userId = "user-a", profileDir = null } = {}) {
  const dir = profileDir || fs.mkdtempSync(join(os.tmpdir(), "sync-"));
  const ctx = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
    // The build ships with no Supabase configured, so the engine is inert
    // until a test points it somewhere. That is the production default:
    // never guess at a backend.
    await page.evaluate(
      ([url, uid]) => window.__db.__configureSync({
        url, apiKey: "fake-anon-key", accessToken: uid, userId: uid, schema: "habits",
      }),
      [FAKE, userId],
    );
    return await fn(page, ctx);
  } finally {
    await ctx.close();
    if (!profileDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

const seedHabit = (page, name) => page.evaluate(
  (n) => window.__db.createHabit({ name: n, type: "boolean", frequencyType: "daily" }), name,
);

async function main() {
  await control({ reset: true });

  await t("3. with the network down, a habit can be logged and reads back immediately", async () => {
    await control({ reset: true, offline: true });
    const r = await withApp(async (page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Offline log", type: "boolean", frequencyType: "daily" });
      const today = await db.getToday();
      const started = performance.now();
      await db.setEntry(h.id, today, 1);
      const elapsed = performance.now() - started;
      return { entry: await db.getEntry(h.id, today), elapsed };
    }));
    await control({ offline: false });
    assert(r.entry?.value === 1, `the entry did not read back: ${JSON.stringify(r.entry)}`);
    // 8. The write must not have waited on the network to answer.
    assert(r.elapsed < 1000, `the write took ${Math.round(r.elapsed)}ms — it waited on the network`);
    return `read back with the server unreachable; the write took ${Math.round(r.elapsed)}ms`;
  });

  await t("4. offline writes queue as pending, in insertion order", async () => {
    await control({ reset: true, offline: true });
    const r = await withApp(async (page) => {
      const h = await seedHabit(page, "Queued");
      return page.evaluate(async (habitId) => {
        const db = window.__db;
        await db.setEntry(habitId, "2026-03-01", 1);
        await db.setEntry(habitId, "2026-03-02", 1);
        return {
          queue: await db.__dumpSyncQueue(),
          pending: await db.getPendingCount(),
          state: await db.getSyncState(),
          raw: await db.__dumpRaw("entries"),
        };
      }, h.id);
    });
    await control({ offline: false });
    const kinds = r.queue.map((q) => `${q.tableName}:${q.operation}`);
    assert(kinds[0] === "habits:upsert", `the habit should be queued first, got ${kinds.join(", ")}`);
    assert(r.queue.length === 3, `expected 3 queued writes, got ${r.queue.length}: ${kinds.join(", ")}`);
    assert(r.queue.every((q, i) => i === 0 || q.id > r.queue[i - 1].id), "the queue is not in insertion order");
    assert(r.pending === 3, `getPendingCount said ${r.pending}`);
    assert(r.raw.every((e) => e.sync_status === "pending"), "a row was not marked pending");
    // §4.1: local-only bookkeeping must not travel.
    assert(r.queue.every((q) => !("sync_status" in q.payload)), "sync_status leaked into a push payload");
    return `${kinds.join(" → ")}, state=${r.state}`;
  });

  await t("5. killing the tab mid-write leaves neither the row nor its queue entry", async () => {
    // The spec's scenario, staged literally: start a burst of writes and
    // destroy the browser part-way through, then reopen the same profile
    // and check the two tables still agree. An earlier version of this
    // test asserted only that nothing looked odd after a write that had
    // in fact completed, which would have passed against a queue written
    // in a separate transaction — the very thing it exists to rule out.
    await control({ reset: true, offline: true });
    const dir = fs.mkdtempSync(join(os.tmpdir(), "sync-kill-"));
    try {
      const habitId = await withApp(async (page) => {
        const h = await seedHabit(page, "Atomic");
        // Fire and deliberately do not await: the kill has to land in the
        // middle of the sequence, not after it.
        page.evaluate((id) => {
          for (let d = 1; d <= 400; d++) {
            const day = String(d % 28 + 1).padStart(2, "0");
            const month = String(d % 12 + 1).padStart(2, "0");
            void window.__db.setEntry(id, `2026-${month}-${day}`, d);
          }
        }, h.id).catch(() => { /* the page is about to be destroyed */ });
        await page.waitForTimeout(60);
        return h.id;
      }, { profileDir: dir });

      const r = await withApp(async (page) => page.evaluate(async () => {
        const db = window.__db;
        const entries = await db.__dumpRaw("entries");
        const queue = await db.__dumpSyncQueue();
        return { entries, queue };
      }), { profileDir: dir });

      // Nothing has synced (the server was unreachable throughout), so
      // every surviving row must still have its queue entry, and every
      // entries queue item must point at a row that exists.
      const queuedIds = new Set(r.queue.filter((q) => q.tableName === "entries").map((q) => q.recordId));
      const rowIds = new Set(r.entries.map((e) => String(e.id)));
      const rowsWithoutQueue = [...rowIds].filter((id) => !queuedIds.has(id));
      const queueWithoutRows = [...queuedIds].filter((id) => !rowIds.has(id));

      assert(r.entries.length > 0, "the kill landed before any write — the test proved nothing");
      assert(rowsWithoutQueue.length === 0,
        `${rowsWithoutQueue.length} rows were written with no queue entry — the server would never hear about them`);
      assert(queueWithoutRows.length === 0,
        `${queueWithoutRows.length} queue entries describe rows that do not exist`);
      return `killed after ${r.entries.length} writes; ${r.queue.length} queue rows, no orphan on either side`;
    } finally {
      await control({ offline: false });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("7. on reconnect the queue drains and rows become synced", async () => {
    await control({ reset: true, offline: true });
    const r = await withApp(async (page) => {
      const h = await seedHabit(page, "Drains");
      await page.evaluate((id) => window.__db.setEntry(id, "2026-05-01", 1), h.id);
      const before = await page.evaluate(() => window.__db.getPendingCount());
      await control({ offline: false });
      const run = await page.evaluate(() => window.__db.__syncNow());
      return {
        before, run,
        after: await page.evaluate(() => window.__db.getPendingCount()),
        state: await page.evaluate(() => window.__db.getSyncState()),
        raw: await page.evaluate(() => window.__db.__dumpRaw("entries")),
      };
    });
    assert(r.before === 2, `expected 2 queued, got ${r.before}`);
    assert(r.run.error === null, `the run reported: ${r.run.error}`);
    assert(r.after === 0, `${r.after} items still queued after a successful drain`);
    assert(r.state === "synced", `state is ${r.state}`);
    assert(r.raw.every((e) => e.sync_status === "synced"), "a row is still marked pending after syncing");
    return `${r.run.pushed} pushed, queue empty, state=${r.state}`;
  });

  await t("10. a row created on device A appears on device B after a pull", async () => {
    await control({ reset: true });
    const created = await withApp(async (page) => {
      const h = await seedHabit(page, "Crosses devices");
      await page.evaluate((id) => window.__db.setEntry(id, "2026-06-01", 1), h.id);
      await page.evaluate(() => window.__db.__syncNow());
      return h;
    }, { userId: "user-a" });

    // A second profile is a second device: separate storage, same account.
    const seen = await withApp(async (page) => page.evaluate(async () => {
      await window.__db.__syncNow();
      return {
        habits: (await window.__db.listHabits()).map((h) => h.name),
        entries: (await window.__db.__dumpRaw("entries")).map((e) => e.date),
      };
    }), { userId: "user-a" });

    assert(seen.habits.includes("Crosses devices"), `device B sees ${JSON.stringify(seen.habits)}`);
    assert(seen.entries.includes("2026-06-01"), `device B sees entries ${JSON.stringify(seen.entries)}`);
    return `habit ${created.id.slice(0, 8)} and its entry arrived on a second device`;
  });

  await t("11. a pull requests only rows newer than last_pull_at", async () => {
    await control({ reset: true });
    const r = await withApp(async (page) => {
      const h = await seedHabit(page, "High water");
      await page.evaluate((id) => window.__db.setEntry(id, "2026-07-01", 1), h.id);
      await page.evaluate(() => window.__db.__syncNow());
      const first = await page.evaluate(() => window.__db.getMeta("last_pull_at"));
      await control({ reset: false }); // keep the store, clear the request log
      const before = (await control({})).log.length;
      const second = await page.evaluate(() => window.__db.__syncNow());
      const after = await control({});
      return { first, second, gets: after.log.slice(before).filter((l) => l.method === "GET") };
    });
    assert(r.first, "last_pull_at was never set after a successful pull");
    // Every GET in the second cycle must have come back empty: nothing
    // changed, so nothing is newer than the mark.
    assert(r.gets.length > 0, "the second cycle issued no pull at all");
    assert(r.gets.every((g) => g.returned === 0),
      `the second pull re-fetched rows it already had: ${JSON.stringify(r.gets)}`);
    return `last_pull_at=${r.first}; the follow-up pull returned ${r.gets.map((g) => g.returned).join(",")} rows`;
  });

  await t("12. last_pull_at does not advance when an apply fails partway", async () => {
    await control({ reset: true });
    const r = await withApp(async (page) => {
      await seedHabit(page, "Partial");
      await page.evaluate(() => window.__db.__syncNow());
      const mark = await page.evaluate(() => window.__db.getMeta("last_pull_at"));
      // routines pulls first, habits second: failing habits means the
      // cycle dies after one table has already been applied.
      await control({ failNext: { table: "habits", status: 500, body: "boom", sticky: true } });
      const run = await page.evaluate(() => window.__db.__syncNow());
      await control({ failNext: null });
      return { mark, run, after: await page.evaluate(() => window.__db.getMeta("last_pull_at")) };
    });
    assert(r.run.error, "the failing pull reported success");
    assert(r.after === r.mark,
      `last_pull_at moved through a failure: ${r.mark} → ${r.after}. The next pull would skip rows.`);
    return `held at ${r.after} while the pull failed: ${r.run.error.slice(0, 60)}`;
  });

  await t("13/14. a deleted entry stays deleted and is invisible to every read", async () => {
    await control({ reset: true });
    const r = await withApp(async (page) => {
      const h = await seedHabit(page, "Stays dead");
      return page.evaluate(async (habitId) => {
        const db = window.__db;
        await db.setEntry(habitId, "2026-08-01", 1);
        await db.__syncNow();
        await db.deleteEntry(habitId, "2026-08-01");
        await db.__syncNow();
        // A pull immediately after is exactly when a naive sync
        // resurrects the row it just deleted.
        await db.__syncNow();
        const raw = await db.__dumpRaw("entries");
        return {
          get: await db.getEntry(habitId, "2026-08-01"),
          forHabit: await db.getEntriesForHabit(habitId, "2026-01-01", "2026-12-31"),
          forDate: await db.getEntriesForDate("2026-08-01"),
          forHabits: await db.getEntriesForHabits([habitId], "2026-01-01", "2026-12-31"),
          count: await db.getEntryCount(habitId),
          first: await db.getFirstEntryDate(habitId),
          dumped: await db.__dumpEntries(),
          tombstones: raw.filter((e) => e.deleted_at != null).length,
        };
      }, h.id);
    });
    assert(r.get === null, `getEntry returned a tombstoned row: ${JSON.stringify(r.get)}`);
    assert(r.forHabit.length === 0, "getEntriesForHabit returned a tombstone");
    assert(r.forDate.length === 0, "getEntriesForDate returned a tombstone");
    assert(r.forHabits.length === 0, "getEntriesForHabits returned a tombstone");
    assert(r.count === 0, `getEntryCount counted a tombstone: ${r.count}`);
    assert(r.first === null, `getFirstEntryDate returned a tombstoned date: ${r.first}`);
    assert(r.dumped.length === 0, "__dumpEntries returned a tombstone");
    // The row must still physically exist, or the next pull brings it back.
    assert(r.tombstones === 1, `expected exactly 1 tombstone row on disk, found ${r.tombstones}`);
    return "invisible to all seven reads, still present as a tombstone";
  });

  await t("15. same habit-day on two devices: the later updated_at wins, nothing is merged", async () => {
    await control({ reset: true });
    const habit = await withApp(async (page) => {
      const h = await seedHabit(page, "Contested");
      await page.evaluate((id) => window.__db.setEntry(id, "2026-09-01", 40), h.id);
      await page.evaluate(() => window.__db.__syncNow());
      return h;
    });

    // Device B pulls, then writes a later value and pushes it.
    await withApp(async (page) => {
      await page.evaluate(() => window.__db.__syncNow());
      await page.evaluate((id) => window.__db.setEntry(id, "2026-09-01", 65), habit.id);
      await page.evaluate(() => window.__db.__syncNow());
    });

    // Device C is a fresh device: whatever it pulls is the resolved state.
    const seen = await withApp(async (page) => page.evaluate(async (id) => {
      await window.__db.__syncNow();
      return window.__db.getEntry(id, "2026-09-01");
    }, habit.id));

    assert(seen?.value === 65, `expected the later write (65), got ${seen?.value}`);
    assert(seen.value !== 105, "the two values were merged — they must never be added");
    return `40 then 65 resolved to ${seen.value}, not 105`;
  });

  await t("16. a server rejection marks the row conflict and surfaces it", async () => {
    await control({ reset: true });
    const r = await withApp(async (page) => {
      const h = await seedHabit(page, "Rejected");
      await page.evaluate(() => window.__db.__syncNow());
      await control({ failNext: { table: "entries", status: 400, body: "value violates check constraint", sticky: true } });
      await page.evaluate((id) => window.__db.setEntry(id, "2026-10-01", 1), h.id);
      const run = await page.evaluate(() => window.__db.__syncNow());
      await control({ failNext: null });
      return {
        run,
        state: await page.evaluate(() => window.__db.getSyncState()),
        raw: await page.evaluate(() => window.__db.__dumpRaw("entries")),
        queue: await page.evaluate(() => window.__db.__dumpSyncQueue()),
      };
    });
    assert(r.run.conflicts === 1, `expected 1 conflict, got ${r.run.conflicts}`);
    assert(r.raw.some((e) => e.sync_status === "conflict"), "no row was marked conflict");
    assert(r.state === "error", `the UI would see "${r.state}" — a rejection must be visible`);
    // Non-negotiable #6: never discarded.
    assert(r.queue.length === 1, `the rejected write was dropped from the queue (${r.queue.length} left)`);
    assert(/check constraint/.test(r.queue[0].lastError || ""), `the reason was lost: ${r.queue[0].lastError}`);
    return `state=error, row marked conflict, reason kept: ${r.queue[0].lastError.slice(0, 60)}`;
  });

  await t("no sync internals are reachable from Layer 2 or the UI", async () => {
    const r = await withApp(async (page) => page.evaluate(() => ({
      logicKeys: Object.keys(window.__logic),
      state: typeof window.__db.getSyncState,
      pending: typeof window.__db.getPendingCount,
    })));
    const leaked = r.logicKeys.filter((k) => /sync|queue|tombstone|conflict|deleted/i.test(k));
    assert(leaked.length === 0, `Layer 2 exposes sync internals: ${leaked.join(", ")}`);
    assert(r.state === "function" && r.pending === "function", "§8's two methods are missing");
    return `Layer 2 exports ${r.logicKeys.length} names, none of them sync-related`;
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
