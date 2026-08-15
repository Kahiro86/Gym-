// Layer 1 acceptance tests — the 31 checks in the Layer 1 spec §9.
//
// These run a real Chromium against the real Worker + OPFS stack through
// window.__db. Nothing is mocked or stubbed: a pass here means the actual
// storage engine behaved, not that a test double did.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

async function openApp(browser, opts = {}) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.__db, null, { timeout: 20000 });
  return { context, page, errors };
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // ══ Fresh origin: migrations and first-run seeding must be observed
  //    before anything else writes here. ══════════════════════════════
  const fresh = await openApp(browser, { timezoneId: "UTC" });

  // The literal "1" these two tests originally asserted was simply the
  // latest migration at the time. Layer 1b §4 adds migration 2, so a
  // hardcoded 1 now asserts that the schema never advances — the opposite
  // of what a forward-only runner is for. LATEST_SCHEMA preserves the
  // claim the tests exist to make: the runner reaches the newest version,
  // and running it again changes nothing.
  const LATEST_SCHEMA = "2";

  await t("30. migration runner brings an empty database up to date; a second run is a no-op", async () => {
    const first = await fresh.page.evaluate(() => window.__db.getMeta("schema_version"));
    assert(first === LATEST_SCHEMA, `expected '${LATEST_SCHEMA}' after first load, got ${first}`);
    // Reloading re-runs the worker bootstrap (and runMigrations) against
    // the now-populated database.
    await fresh.page.reload();
    await fresh.page.waitForFunction(() => !!window.__db, null, { timeout: 20000 });
    const second = await fresh.page.evaluate(() => window.__db.getMeta("schema_version"));
    assert(second === LATEST_SCHEMA, `expected '${LATEST_SCHEMA}' after a second bootstrap, got ${second}`);
  });

  await t("31. meta is seeded on first run: schema version, day_start_hour=4, a device id", async () => {
    const r = await fresh.page.evaluate(async () => ({
      sv: await window.__db.getMeta("schema_version"),
      dsh: await window.__db.getDayStartHour(),
      device: await window.__db.getMeta("device_id"),
      lastPull: await window.__db.getMeta("last_pull_at"),
    }));
    assert(r.sv === LATEST_SCHEMA, `schema_version = ${r.sv}`);
    assert(r.dsh === 4, `day_start_hour = ${r.dsh}`);
    assert(/^[0-9a-f-]{36}$/.test(r.device ?? ""), `device_id is not a uuid: ${r.device}`);
    // §4.3: last_pull_at stays absent until a pull actually succeeds.
    // "Never pulled" and "pulled, found nothing" are different facts.
    assert(r.lastPull === null, `last_pull_at should be unset before any pull, got ${r.lastPull}`);
  });

  assert(fresh.errors.length === 0, `console errors: ${fresh.errors.join("; ")}`);
  await fresh.context.close();

  // ══ Main context ═════════════════════════════════════════════════
  const app = await openApp(browser, { timezoneId: "UTC" });
  const run = (fn, arg) => app.page.evaluate(fn, arg);

  await t("1. a duplicate (habit_id, date) INSERT is rejected by the schema", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Constraint", type: "boolean", frequencyType: "daily" });
      // A plain INSERT with no ON CONFLICT — the only way to genuinely
      // attempt a duplicate. setEntry upserts and so can never produce
      // the violation this test has to prove exists.
      await db.__rawInsertEntry(h.id, "2026-01-01", 1);
      let error = null;
      try { await db.__rawInsertEntry(h.id, "2026-01-01", 1); }
      catch (e) { error = { name: e.name, message: e.message }; }
      const rows = (await db.__dumpEntries()).filter((e) => e.habitId === h.id);
      return { error, rowCount: rows.length };
    });
    assert(r.error !== null, "the second INSERT was accepted — UNIQUE(habit_id,date) is NOT enforced");
    assert(r.error.name === "ConstraintError", `expected ConstraintError, got ${r.error.name}: ${r.error.message}`);
    assert(r.rowCount === 1, `expected exactly 1 surviving row, got ${r.rowCount}`);
    return `rejected with: ${r.error.message.slice(0, 90)}`;
  });

  await t("2. setEntry twice → one row, second value wins, created_at and id unchanged", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Upsert", type: "numeric", target: 1, frequencyType: "daily" });
      const a = await db.setEntry(h.id, "2026-02-02", 5);
      await new Promise((res) => setTimeout(res, 15));
      const b = await db.setEntry(h.id, "2026-02-02", 9);
      return { count: await db.getEntryCount(h.id), a, b };
    });
    assert(r.count === 1, `expected 1 row, got ${r.count}`);
    assert(r.b.value === 9, `expected value 9, got ${r.b.value}`);
    assert(r.a.createdAt === r.b.createdAt, `created_at changed: ${r.a.createdAt} → ${r.b.createdAt}`);
    assert(r.a.id === r.b.id, "row id changed across the upsert");
    assert(r.b.updatedAt > r.a.updatedAt, "updated_at did not advance");
  });

  await t("3. deleteHabit needs { confirmed: true }; with it, entries cascade", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Delete", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-03-01", 1);
      let blocked = null;
      try { await db.deleteHabit(h.id); } catch (e) { blocked = e.name; }
      const survived = await db.getHabit(h.id).then(() => true).catch(() => false);
      await db.deleteHabit(h.id, { confirmed: true });
      const gone = await db.getHabit(h.id).then(() => false).catch((e) => e.name === "NotFoundError");
      const orphans = (await db.__dumpEntries()).filter((e) => e.habitId === h.id).length;
      return { blocked, survived, gone, orphans };
    });
    assert(r.blocked === "ConfirmationRequiredError", `expected ConfirmationRequiredError, got ${r.blocked}`);
    assert(r.survived, "habit was removed by an unconfirmed delete");
    assert(r.gone, "habit still present after a confirmed delete");
    assert(r.orphans === 0, `${r.orphans} orphaned entries survived the cascade`);
  });

  await t("4. archiving preserves entries; unarchiving restores with history intact", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Archive", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-03-05", 1);
      await db.archiveHabit(h.id);
      const archived = await db.getHabit(h.id);
      const listedWhileArchived = (await db.listHabits()).some((x) => x.id === h.id);
      const listedWithFlag = (await db.listHabits({ includeArchived: true })).some((x) => x.id === h.id);
      const keptEntries = await db.getEntryCount(h.id);
      await db.unarchiveHabit(h.id);
      return {
        archivedAt: archived.archivedAt, listedWhileArchived, listedWithFlag, keptEntries,
        restoredArchivedAt: (await db.getHabit(h.id)).archivedAt,
        restoredEntries: await db.getEntryCount(h.id),
      };
    });
    assert(r.archivedAt !== null, "archived_at was not set");
    assert(r.listedWhileArchived === false, "archived habit still appears in the active list");
    assert(r.listedWithFlag === true, "archived habit missing from includeArchived list");
    assert(r.keptEntries === 1, "entries were lost on archive");
    assert(r.restoredArchivedAt === null, "archived_at not cleared on unarchive");
    assert(r.restoredEntries === 1, "entries were lost on unarchive");
  });

  await t("5. foreign keys are enforced — an entry for a nonexistent habit fails", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const ghost = "00000000-0000-0000-0000-000000000000";
      const viaSetEntry = await db.setEntry(ghost, "2026-01-01", 1).then(() => null).catch((e) => e.name);
      // Also bypass the app-level existence check to prove the FK itself
      // is live, not just the guard in front of it.
      const viaRawInsert = await db.__rawInsertEntry(ghost, "2026-01-01", 1).then(() => null).catch((e) => e.name);
      return { viaSetEntry, viaRawInsert };
    });
    assert(r.viaSetEntry === "NotFoundError", `setEntry gave ${r.viaSetEntry}`);
    assert(r.viaRawInsert === "ConstraintError", `raw insert gave ${r.viaRawInsert} — PRAGMA foreign_keys may be off`);
    return "blocked at both the application guard and the FK constraint";
  });

  await t("7. Jan 31 and Feb 1 are distinct rows in the right order", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "MonthEdge", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-01-31", 1);
      await db.setEntry(h.id, "2026-02-01", 1);
      return (await db.getEntriesForHabit(h.id, "2026-01-01", "2026-02-28")).map((e) => e.date);
    });
    assert(JSON.stringify(r) === JSON.stringify(["2026-01-31", "2026-02-01"]), JSON.stringify(r));
  });

  await t("8. a range across a month boundary returns exactly its 7 days", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "RangeMonth", type: "boolean", frequencyType: "daily" });
      for (const d of ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
        "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) await db.setEntry(h.id, d, 1);
      return (await db.getEntriesForHabit(h.id, "2026-07-28", "2026-08-03")).map((e) => e.date);
    });
    assert(r.length === 7, `expected 7, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[0] === "2026-07-28" && r[6] === "2026-08-03", `bounds leaked: ${JSON.stringify(r)}`);
  });

  await t("9. a range across a year boundary returns exactly its 7 days", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "RangeYear", type: "boolean", frequencyType: "daily" });
      for (const d of ["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31",
        "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]) await db.setEntry(h.id, d, 1);
      return (await db.getEntriesForHabit(h.id, "2025-12-29", "2026-01-04")).map((e) => e.date);
    });
    assert(r.length === 7, `expected 7, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[0] === "2025-12-29" && r[6] === "2026-01-04", `bounds leaked: ${JSON.stringify(r)}`);
  });

  await t("10. stored date strings sort lexicographically in true chronological order", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Sorting", type: "boolean", frequencyType: "daily" });
      for (const d of ["2026-01-02", "2025-12-31", "2026-01-01", "2025-12-30"]) await db.setEntry(h.id, d, 1);
      return (await db.getEntriesForHabit(h.id, "2025-01-01", "2026-12-31")).map((e) => e.date);
    });
    assert(JSON.stringify(r) === JSON.stringify(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]), JSON.stringify(r));
  });

  // ── Day-start hour ─────────────────────────────────────────────────
  const atClock = async (iso, body) => run(async ({ iso, bodySrc }) => {
    const db = window.__db;
    await db.__setTestClock(new Date(iso).getTime());
    const out = await new Function("db", `return (${bodySrc})(db)`)(db);
    await db.__setTestClock(null);
    return out;
  }, { iso, bodySrc: body.toString() });

  await t("12. day_start_hour=4: 00:30 Wednesday still reports Tuesday", async () => {
    await run(() => window.__db.setDayStartHour(4));
    const today = await atClock("2026-08-12T00:30:00Z", (db) => db.getToday());
    assert(today === "2026-08-11", `got ${today}`);
  });

  await t("13. day_start_hour=4: 03:59 → Tuesday, 04:00 → Wednesday (to the minute)", async () => {
    const before = await atClock("2026-08-12T03:59:00Z", (db) => db.getToday());
    const after = await atClock("2026-08-12T04:00:00Z", (db) => db.getToday());
    assert(before === "2026-08-11", `03:59 gave ${before}`);
    assert(after === "2026-08-12", `04:00 gave ${after}`);
  });

  await t("14. day_start_hour=4: 12:00 and 23:50 both report the same Wednesday", async () => {
    const noon = await atClock("2026-08-12T12:00:00Z", (db) => db.getToday());
    const night = await atClock("2026-08-12T23:50:00Z", (db) => db.getToday());
    assert(noon === "2026-08-12" && night === "2026-08-12", `${noon} / ${night}`);
  });

  await t("15. day_start_hour=0 is exactly standard midnight, with no off-by-one", async () => {
    await run(() => window.__db.setDayStartHour(0));
    const late = await atClock("2026-08-12T23:59:00Z", (db) => db.getToday());
    const early = await atClock("2026-08-13T00:01:00Z", (db) => db.getToday());
    await run(() => window.__db.setDayStartHour(4));
    assert(late === "2026-08-12", `23:59 gave ${late}`);
    assert(early === "2026-08-13", `00:01 gave ${early}`);
  });

  await t("16. the offset crosses a month boundary: Aug 1 01:00 → 2026-07-31", async () => {
    const r = await atClock("2026-08-01T01:00:00Z", (db) => db.getToday());
    assert(r === "2026-07-31", `got ${r}`);
  });

  await t("17. the offset crosses a year boundary: Jan 1 02:00 → 2026-12-31", async () => {
    const r = await atClock("2027-01-01T02:00:00Z", (db) => db.getToday());
    assert(r === "2026-12-31", `got ${r}`);
  });

  await t("18. changing day_start_hour 4 → 0 modifies no entry row", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "DSHStable", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-04-01", 1);
      await db.setEntry(h.id, "2026-04-02", 0);
      await db.setDayStartHour(4);
      const before = JSON.stringify(await db.__dumpEntries());
      await db.setDayStartHour(0);
      const after = JSON.stringify(await db.__dumpEntries());
      await db.setDayStartHour(4);
      return { same: before === after, rows: JSON.parse(before).length };
    });
    assert(r.same, "the entries table changed — setDayStartHour must only touch meta");
    return `${r.rows} rows byte-identical before and after`;
  });

  await t("19. a date picked by hand is stored exactly as picked, with no offset applied", async () => {
    const r = await atClock("2026-08-12T00:30:00Z", async (db) => {
      // getToday() here would be 2026-08-11; the explicit date must win.
      const h = await db.createHabit({ name: "ManualDate", type: "boolean", frequencyType: "daily" });
      const e = await db.setEntry(h.id, "2026-08-12", 1);
      return { stored: e.date, todayWouldBe: await db.getToday() };
    });
    assert(r.stored === "2026-08-12", `stored ${r.stored}`);
    assert(r.todayWouldBe === "2026-08-11", `sanity check failed: getToday() gave ${r.todayWouldBe}`);
    return `stored ${r.stored} while getToday() was ${r.todayWouldBe}`;
  });

  await t("20. setDayStartHour rejects -1, 24, and non-integers", async () => {
    const r = await run(async () => {
      const out = [];
      for (const bad of [-1, 24, 3.5]) {
        out.push(await window.__db.setDayStartHour(bad).then(() => "accepted").catch((e) => e.name));
      }
      await window.__db.setDayStartHour(4);
      return out;
    });
    assert(r.every((x) => x === "ValidationError"), JSON.stringify(r));
  });

  // ── Validation ─────────────────────────────────────────────────────
  await t("22. a numeric habit without a target is rejected", async () => {
    const r = await run(() => window.__db
      .createHabit({ name: "NoTarget", type: "numeric", frequencyType: "daily" })
      .then(() => "accepted").catch((e) => e.name));
    assert(r === "ValidationError", `got ${r}`);
  });

  await t("23. a boolean habit with a unit is rejected", async () => {
    const r = await run(() => window.__db
      .createHabit({ name: "BoolUnit", type: "boolean", unit: "pages", frequencyType: "daily" })
      .then(() => "accepted").catch((e) => e.name));
    assert(r === "ValidationError", `got ${r}`);
  });

  await t("24. specific_days rejects empty, out-of-range, and duplicate day arrays", async () => {
    const r = await run(async () => {
      const out = [];
      for (const days of [[], [0, 7], [-1], [1, 1]]) {
        out.push(await window.__db
          .createHabit({ name: "Days", type: "boolean", frequencyType: "specific_days", frequencyDays: days })
          .then(() => "accepted").catch((e) => e.name));
      }
      return out;
    });
    assert(r.every((x) => x === "ValidationError"), JSON.stringify(r));
  });

  await t("25. changing a habit's type while entries exist is refused", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "TypeChange", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-05-01", 1);
      const blocked = await db.updateHabit(h.id, { type: "numeric", target: 5 })
        .then(() => "accepted").catch((e) => e.name);
      // The same change must be allowed once the entries are gone.
      await db.deleteEntry(h.id, "2026-05-01");
      const allowed = await db.updateHabit(h.id, { type: "numeric", target: 5 })
        .then((x) => x.type).catch((e) => e.name);
      return { blocked, allowed };
    });
    assert(r.blocked === "IllegalStateChangeError", `got ${r.blocked}`);
    assert(r.allowed === "numeric", `type change should be allowed with no entries, got ${r.allowed}`);
  });

  // ── State model ────────────────────────────────────────────────────
  await t("26. the tri-state cycle is: no row → value 1 → value 0 → no row", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "TriState", type: "boolean", frequencyType: "daily" });
      const d = "2026-06-01";
      const seen = [];
      const snap = async () => {
        const e = await db.getEntry(h.id, d);
        seen.push(e === null ? "no row" : `value ${e.value}`);
      };
      await snap();
      await window.__logic.toggleEntry(db, h.id, d); await snap();
      await window.__logic.toggleEntry(db, h.id, d); await snap();
      await window.__logic.toggleEntry(db, h.id, d); await snap();
      return seen;
    });
    assert(JSON.stringify(r) === JSON.stringify(["no row", "value 1", "value 0", "no row"]), JSON.stringify(r));
    return r.join(" → ");
  });

  await t("27. an explicit miss and an unlogged day are distinguishable", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "MissVsBlank", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-06-10", 0);
      return { missed: await db.getEntry(h.id, "2026-06-10"), untouched: await db.getEntry(h.id, "2026-06-11") };
    });
    assert(r.missed && r.missed.value === 0, `expected a row with value 0, got ${JSON.stringify(r.missed)}`);
    assert(r.untouched === null, `expected null, got ${JSON.stringify(r.untouched)}`);
  });

  await t("28. getEntriesForHabits over 10 habits × 30 days is ONE statement, not ten", async () => {
    const r = await run(async () => {
      const db = window.__db;
      const ids = [];
      for (let i = 0; i < 10; i++) {
        const h = await db.createHabit({ name: `Batch ${i}`, type: "boolean", frequencyType: "daily" });
        ids.push(h.id);
        for (let d = 1; d <= 30; d++) await db.setEntry(h.id, `2026-09-${String(d).padStart(2, "0")}`, 1);
      }
      await db.__resetStatementCount();
      const rows = await db.getEntriesForHabits(ids, "2026-09-01", "2026-09-30");
      return { rows: rows.length, statements: await db.__getStatementCount() };
    });
    assert(r.rows === 300, `expected 300 rows, got ${r.rows}`);
    assert(r.statements === 1, `expected 1 statement, got ${r.statements}`);
  });

  assert(app.errors.length === 0, `console errors: ${app.errors.join("; ")}`);
  await app.context.close();

  // ══ Timezones — fixed-offset zones, so the arithmetic is unambiguous.
  //    Kiritimati is UTC+14; Niue is UTC-11. ═══════════════════════════
  for (const [label, tz, localIso, expected] of [
    ["6a. east of UTC (+14)", "Pacific/Kiritimati", "2026-08-15T00:30:00+14:00", "2026-08-15"],
    ["6b. west of UTC (-11)", "Pacific/Niue", "2026-08-14T23:30:00-11:00", "2026-08-14"],
  ]) {
    const ctx = await openApp(browser, { timezoneId: tz });
    await t(`${label}: the LOCAL date is stored, not the UTC one`, async () => {
      const r = await ctx.page.evaluate(async ({ iso }) => {
        const db = window.__db;
        await db.setDayStartHour(0); // isolate timezone handling from the offset
        await db.__setTestClock(new Date(iso).getTime());
        const today = await db.getToday();
        const h = await db.createHabit({ name: "TZ", type: "boolean", frequencyType: "daily" });
        const entry = await db.setEntry(h.id, today, 1);
        await db.__setTestClock(null);
        await db.setDayStartHour(4);
        return { today, stored: entry.date, utcDate: new Date(iso).toISOString().slice(0, 10) };
      }, { iso: localIso });
      assert(r.today === expected, `getToday() gave ${r.today}, expected ${expected} (UTC that instant: ${r.utcDate})`);
      assert(r.stored === expected, `entry stored under ${r.stored}`);
      return `local ${expected} kept while UTC read ${r.utcDate}`;
    });
    assert(ctx.errors.length === 0, `console errors: ${ctx.errors.join("; ")}`);
    await ctx.context.close();
  }

  // ══ DST — New York falls back on 2026-11-01. ══════════════════════
  const dst = await openApp(browser, { timezoneId: "America/New_York" });
  await t("11. entries survive a DST transition unchanged", async () => {
    const r = await dst.page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "DST", type: "boolean", frequencyType: "daily" });
      await db.__setTestClock(new Date("2026-10-31T12:00:00-04:00").getTime()); // EDT
      const before = await db.getToday();
      await db.setEntry(h.id, before, 1);
      await db.__setTestClock(new Date("2026-11-02T12:00:00-05:00").getTime()); // EST
      const after = await db.getEntry(h.id, before);
      const todayAfter = await db.getToday();
      await db.__setTestClock(null);
      return { before, value: after?.value, date: after?.date, todayAfter };
    });
    assert(r.before === "2026-10-31", `pre-transition date was ${r.before}`);
    assert(r.value === 1 && r.date === "2026-10-31", `entry shifted or vanished: ${JSON.stringify(r)}`);
    assert(r.todayAfter === "2026-11-02", `post-transition today was ${r.todayAfter}`);
    return "the completion stayed on 2026-10-31 across the fall-back";
  });
  assert(dst.errors.length === 0, `console errors: ${dst.errors.join("; ")}`);
  await dst.context.close();
  await browser.close();

  // ══ Static check ═════════════════════════════════════════════════
  await t("21. a no-argument `new Date()` appears in exactly one place: clock.ts", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(srcDir);
    const hits = files.filter((f) => {
      // Strip comments first: prose mentioning the pattern is not a call.
      const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      return /new Date\(\s*\)/.test(code);
    });
    assert(hits.length === 1, `expected exactly 1 file, found ${hits.length}: ${hits.join(", ")}`);
    assert(hits[0].endsWith(join("db", "clock.ts")), `the single call is in ${hits[0]}, not db/clock.ts`);
    return `scanned ${files.length} source files`;
  });

  // ══ Persistence across a genuine browser restart ═════════════════
  const profile = fs.mkdtempSync(join(os.tmpdir(), "habit-restart-"));
  let habitId;
  {
    const ctx = await chromium.launchPersistentContext(profile, { args: ["--no-sandbox"] });
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => !!window.__db, null, { timeout: 20000 });
    habitId = await page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Survivor", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-01-15", 1);
      return h.id;
    });
    await ctx.close(); // tears the browser process down entirely
  }
  await t("29. data survives a full browser restart, proving OPFS persistence is real", async () => {
    const ctx = await chromium.launchPersistentContext(profile, { args: ["--no-sandbox"] });
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => !!window.__db, null, { timeout: 20000 });
    const r = await page.evaluate(async (id) => ({
      entry: await window.__db.getEntry(id, "2026-01-15"),
      habit: await window.__db.getHabit(id).then((h) => h.name).catch(() => null),
    }), habitId);
    await ctx.close();
    assert(r.habit === "Survivor", `habit did not survive: ${r.habit}`);
    assert(r.entry?.value === 1, `entry did not survive: ${JSON.stringify(r.entry)}`);
    return "a new browser process read back data written by the previous one";
  });
  fs.rmSync(profile, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
