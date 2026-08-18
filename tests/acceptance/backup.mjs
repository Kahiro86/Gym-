// Handoff B1 — export and import, against the real database.
//
// The transactional guarantee is the reason this suite exists. A partial
// import is worse than a failed one: someone restoring a backup would be
// left with a database that is neither their old data nor their file, and
// no way to tell which rows came from where.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5199/Gym-/";
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

async function withApp(fn) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "backup-"));
  const ctx = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
    return await fn(page);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A small but complete dataset: a group, three habits, some history. */
const SEED = `async () => {
  const db = window.__db;
  const r = await db.createRoutine({ name: "Morning" });
  const a = await db.createHabit({ name: "Meditate", type: "boolean", frequencyType: "daily", routineId: r.id });
  const b = await db.createHabit({ name: "Water", type: "numeric", target: 2, unit: "L", frequencyType: "daily" });
  const c = await db.createHabit({
    name: "Gym", type: "boolean", frequencyType: "specific_days", frequencyDays: [1, 3, 5],
  });
  for (const d of ["2026-08-10", "2026-08-11", "2026-08-12"]) await db.setEntry(a.id, d, 1);
  await db.setEntry(a.id, "2026-08-13", 0);
  await db.setEntry(b.id, "2026-08-12", 1.5);
  await db.setEntry(c.id, "2026-08-12", 1);
  return { routineId: r.id, ids: [a.id, b.id, c.id] };
}`;

async function main() {
  await t("export_roundtrips — exportAll output passes validateImport and restores everything", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      await (eval(seedSrc))();
      const file = await L.exportAll(db);
      const report = L.validateImport(file, Number(await db.getMeta("schema_version")));

      const before = {
        habits: (await db.listHabits()).map((h) => h.name).sort(),
        routines: (await db.listRoutines()).map((x) => x.name).sort(),
        entries: (await db.__dumpEntries()).map((e) => `${e.habitId}|${e.date}|${e.value}`).sort(),
      };

      // Wipe, then restore from the file alone.
      await L.importAll(db, { ...file, routines: [], habits: [], entries: [] }, { mode: "replace", confirmed: true });
      const emptied = (await db.listHabits()).length;
      await L.importAll(db, file, { mode: "replace", confirmed: true });

      return {
        report, before, emptied,
        after: {
          habits: (await db.listHabits()).map((h) => h.name).sort(),
          routines: (await db.listRoutines()).map((x) => x.name).sort(),
          entries: (await db.__dumpEntries()).map((e) => `${e.habitId}|${e.date}|${e.value}`).sort(),
        },
        // The habit's full shape has to survive, not just its name.
        gym: (await db.listHabits()).find((h) => h.name === "Gym"),
      };
    }, SEED));

    assert(r.report.ok, `its own export failed validation: ${JSON.stringify(r.report.errors)}`);
    assert(r.emptied === 0, `the wipe left ${r.emptied} habits`);
    assert(JSON.stringify(r.after) === JSON.stringify(r.before),
      `the restore differs:\n  before ${JSON.stringify(r.before)}\n  after  ${JSON.stringify(r.after)}`);
    assert(r.gym.frequencyType === "specific_days" && JSON.stringify(r.gym.frequencyDays) === "[1,3,5]",
      `the schedule did not survive: ${JSON.stringify(r.gym)}`);
    return `${r.before.habits.length} habits, ${r.before.entries.length} entries, byte-identical after a wipe and restore`;
  });

  await t("import_validates_before_writing — a bad file changes nothing", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      await (eval(seedSrc))();
      const before = (await db.__dumpEntries()).length;
      const file = await L.exportAll(db);
      // One impossible date, deep in an otherwise valid file.
      file.entries[1].date = "2026-02-30";
      const { report, result } = await L.importAll(db, file, { mode: "replace", confirmed: true });
      return { before, report, result, after: (await db.__dumpEntries()).length,
        habits: (await db.listHabits()).length };
    }, SEED));

    assert(r.report.ok === false, "the bad file was accepted");
    assert(r.result === null, "a write was attempted anyway");
    // Crucially: replace did NOT clear first and then discover the problem.
    assert(r.after === r.before, `${r.before} entries became ${r.after} — the database was touched`);
    assert(r.habits === 3, `habits were destroyed: ${r.habits}`);
    return `refused with ${r.report.errors.length} error(s); ${r.after} entries untouched`;
  });

  await t("import_is_transactional — a failure part-way leaves the database as it was", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      await (eval(seedSrc))();
      const before = {
        habits: (await db.listHabits()).length,
        entries: (await db.__dumpEntries()).length,
      };
      // Bypasses Layer 2's validation deliberately, to make Layer 1's
      // write fail mid-flight: the second habit refers to a routine that
      // does not exist, so the foreign key rejects it after the first
      // habit has already been inserted.
      const file = await L.exportAll(db);
      let failed = null;
      try {
        await db.importData({
          routines: [],
          habits: [
            { ...file.habits[0], id: "new-1", routine_id: null },
            { ...file.habits[1], id: "new-2", routine_id: "does-not-exist" },
          ],
          entries: [],
          meta: [],
        }, { mode: "merge" });
      } catch (e) { failed = e.name; }

      return { before, failed, after: {
        habits: (await db.listHabits()).length,
        entries: (await db.__dumpEntries()).length,
      } };
    }, SEED));

    assert(r.failed !== null, "the invalid write was accepted");
    assert(r.after.habits === r.before.habits,
      `${r.after.habits - r.before.habits} habit(s) survived a rolled-back import`);
    assert(r.after.entries === r.before.entries, "entries changed during a rolled-back import");
    return `threw ${r.failed}; ${r.after.habits} habits and ${r.after.entries} entries, exactly as before`;
  });

  await t("import_rejects_wrong_schema_version", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      await (eval(seedSrc))();
      const file = await L.exportAll(db);
      const fromFuture = { ...file, schemaVersion: file.schemaVersion + 5 };
      const { report, result } = await L.importAll(db, fromFuture, { mode: "merge" });
      return { report, result, habits: (await db.listHabits()).length };
    }, SEED));
    assert(r.report.ok === false, "a file from a newer schema was accepted");
    assert(r.result === null, "it was written anyway");
    assert(r.habits === 3, "the database was modified");
    return r.report.errors[0].message.slice(0, 90);
  });

  await t("replace_requires_confirmation", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      await (eval(seedSrc))();
      const file = await L.exportAll(db);
      let blocked = null;
      try { await L.importAll(db, file, { mode: "replace" }); } catch (e) { blocked = e.name; }
      // Merge needs no flag: it destroys nothing.
      const merged = await L.importAll(db, file, { mode: "merge" });
      return { blocked, merged: merged.result !== null, habits: (await db.listHabits()).length };
    }, SEED));
    assert(r.blocked === "ConfirmationRequiredError", `replace was allowed unconfirmed: ${r.blocked}`);
    assert(r.merged, "merge was blocked, though it destroys nothing");
    assert(r.habits === 3, `merge duplicated habits: ${r.habits}`);
    return "replace demands the flag; merge does not, and does not duplicate";
  });

  await t("merge keeps the newer of the two versions of a row", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      const { ids } = await (eval(seedSrc))();
      const file = await L.exportAll(db);

      // The local copy moves on after the backup was taken.
      await db.updateHabit(ids[0], { name: "Meditate (renamed locally)" });
      const { result } = await L.importAll(db, file, { mode: "merge" });

      return {
        result,
        name: (await db.getHabit(ids[0])).name,
        count: (await db.listHabits()).length,
      };
    }, SEED));
    assert(r.name === "Meditate (renamed locally)",
      `an older backup overwrote a newer local edit: ${r.name}`);
    assert(r.result.skipped >= 1, `nothing was skipped: ${JSON.stringify(r.result)}`);
    assert(r.count === 3, `merge changed the habit count: ${r.count}`);
    return `kept the newer local name; ${r.result.skipped} older row(s) skipped`;
  });

  await t("an imported row is queued for sync, like any other local write", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      await (eval(seedSrc))();
      const file = await L.exportAll(db);
      await L.importAll(db, file, { mode: "replace", confirmed: true });
      const queue = await db.__dumpSyncQueue();
      const rows = await db.__dumpRaw("habits");
      return {
        queuedHabits: queue.filter((q) => q.tableName === "habits").length,
        pending: rows.filter((h) => h.sync_status === "pending").length,
      };
    }, SEED));
    // Restored data has never reached a server, whatever it once was.
    assert(r.queuedHabits === 3, `${r.queuedHabits} habits queued, expected 3`);
    assert(r.pending === 3, `${r.pending} rows marked pending, expected 3`);
    return "3 habits restored, 3 queued, 3 marked pending";
  });

  await t("export excludes tombstones and local sync bookkeeping", async () => {
    const r = await withApp(async (page) => page.evaluate(async (seedSrc) => {
      const db = window.__db, L = window.__logic;
      const { ids } = await (eval(seedSrc))();
      await db.deleteEntry(ids[0], "2026-08-10");
      const file = await L.exportAll(db);
      return {
        dates: file.entries.map((e) => e.date),
        keys: Object.keys(file.entries[0] ?? {}),
        metaKeys: file.meta.map((m) => m.key),
      };
    }, SEED));
    assert(!r.dates.includes("2026-08-10"), "a deleted day was exported");
    assert(!r.keys.includes("sync_status"), `sync_status leaked into the file: ${r.keys.join(",")}`);
    assert(!r.keys.includes("deleted_at"), `deleted_at leaked into the file: ${r.keys.join(",")}`);
    // device_id belongs to the device, not the history.
    assert(!r.metaKeys.includes("device_id"), `device_id leaked into the file: ${r.metaKeys.join(",")}`);
    return `${r.dates.length} live entries, no tombstone, no bookkeeping`;
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
