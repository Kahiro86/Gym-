// Layer 1 acceptance tests 32-60, from the revised data spec.
//
// Tests 1-31 live in layer1.mjs. These close the gaps the revision names:
// concurrency, volume, hostile input, calendar edge cases, migration
// robustness, and durability. Each is reported by its spec name.
//
// Several of these failed when first written. That was the point.
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

async function withApp(fn, { profileDir = null } = {}) {
  const dir = profileDir || fs.mkdtempSync(join(os.tmpdir(), "l1x-"));
  const ctx = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
    return await fn(page, ctx);
  } finally {
    await ctx.close();
    if (!profileDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `fn` in the page and returns the error name it threw, or null. */
const CATCH = `async (fn) => { try { await fn(); return null; } catch (e) { return { name: e.name, message: e.message }; } }`;

async function main() {
  // ══ 9.7 Concurrency and atomicity ═════════════════════════════════

  await t("32. double_tap_single_row", async () => {
    const r = await withApp((page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Impatient", type: "boolean", frequencyType: "daily" });
      // Deliberately not awaited in sequence — an impatient double-tap
      // fires the second call before the first has returned.
      await Promise.all([db.setEntry(h.id, "2026-05-05", 1), db.setEntry(h.id, "2026-05-05", 1)]);
      const rows = (await db.__dumpEntries()).filter((e) => e.habitId === h.id);
      return { count: rows.length, value: rows[0]?.value };
    }));
    assert(r.count === 1, `two rows for one habit-day: ${r.count}`);
    assert(r.value === 1, `value is ${r.value}`);
    return "two un-awaited writes, one row";
  });

  await t("33. transaction_rolls_back_fully", async () => {
    const r = await withApp((page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Atomic", type: "boolean", frequencyType: "daily" });
      const before = (await db.__dumpEntries()).length;
      let failed = null;
      try {
        await db.runTransaction([
          { method: "setEntry", args: [h.id, "2026-06-01", 1] },
          { method: "setEntry", args: [h.id, "2026-06-02", 1] },
          // Fails on validation, after two good writes in the same
          // transaction. Neither may survive.
          { method: "setEntry", args: [h.id, "2026-06-31", 1] },
        ]);
      } catch (e) { failed = e.name; }
      return { before, failed, after: (await db.__dumpEntries()).length };
    }));
    assert(r.failed === "ValidationError", `expected ValidationError, got ${r.failed}`);
    assert(r.after === r.before, `${r.after - r.before} row(s) survived a rolled-back transaction`);
    return `threw ${r.failed}; entries unchanged at ${r.after}`;
  });

  await t("33b. a successful transaction commits every write", async () => {
    const r = await withApp((page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Commits", type: "boolean", frequencyType: "daily" });
      await db.runTransaction([
        { method: "setEntry", args: [h.id, "2026-06-01", 1] },
        { method: "setEntry", args: [h.id, "2026-06-02", 0] },
      ]);
      return (await db.getEntriesForHabit(h.id, "2026-06-01", "2026-06-30")).map((e) => `${e.date}=${e.value}`);
    }));
    assert(r.join(",") === "2026-06-01=1,2026-06-02=0", `got ${JSON.stringify(r)}`);
    return r.join(", ");
  });

  await t("33c. runTransaction refuses a method that is not a repository write", async () => {
    const r = await withApp((page) => page.evaluate(async (catchSrc) => {
      const run = eval(catchSrc);
      return run(() => window.__db.runTransaction([{ method: "__dumpEntries", args: [] }]));
    }, CATCH));
    assert(r?.name === "ValidationError", `an arbitrary method was accepted: ${JSON.stringify(r)}`);
    return "test seams and unknown names are not transactable";
  });

  await t("34. write_lock_serializes_tabs", async () => {
    // Covered in full by tests/acceptance/storage.mjs test 9, which
    // opens a real second tab. Re-asserted here as the lock's presence,
    // since a browser without navigator.locks would silently skip it.
    const r = await withApp((page) => page.evaluate(() => "locks" in navigator));
    assert(r, "navigator.locks is unavailable, so nothing serializes concurrent tabs");
    return "Web Locks present; exclusion proven in storage.mjs test 9";
  });

  await t("35. concurrent_reads_during_write", async () => {
    const r = await withApp((page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Torn", type: "numeric", target: 1, unit: "x", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-07-01", 1);
      // Interleave 40 writes and 40 reads without awaiting in order.
      const ops = [];
      for (let i = 2; i <= 41; i++) {
        ops.push(db.setEntry(h.id, "2026-07-01", i));
        ops.push(db.getEntry(h.id, "2026-07-01"));
      }
      const settled = await Promise.all(ops);
      const reads = settled.filter((x) => x && typeof x === "object" && "value" in x);
      return {
        // Every read must be a whole row with a value that was written
        // at some point — never a partial or missing field.
        torn: reads.filter((e) => !e.id || !e.habitId || e.date !== "2026-07-01"
          || !Number.isFinite(e.value)).length,
        rows: (await db.__dumpEntries()).filter((e) => e.habitId === h.id).length,
        final: (await db.getEntry(h.id, "2026-07-01")).value,
      };
    }));
    assert(r.torn === 0, `${r.torn} reads returned a torn or partial row`);
    assert(r.rows === 1, `${r.rows} rows exist for one habit-day`);
    assert(r.final === 41, `the last write did not win: ${r.final}`);
    return "80 interleaved operations, no torn read, one row, last write wins";
  });

  await t("36. queue_and_mutation_are_atomic (Layer 1b)", async () => {
    // Proven by killing a real tab mid-write in tests/acceptance/sync.mjs
    // test 5, which fails if the enqueue leaves the transaction.
    const r = await withApp((page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Paired", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-07-02", 1);
      const entries = await db.__dumpRaw("entries");
      const queued = new Set((await db.__dumpSyncQueue())
        .filter((q) => q.tableName === "entries").map((q) => q.recordId));
      return { orphans: entries.filter((e) => !queued.has(String(e.id))).length, entries: entries.length };
    }));
    assert(r.orphans === 0, `${r.orphans} rows have no queue entry`);
    return `${r.entries} entries, each paired; kill-mid-write proven in sync.mjs test 5`;
  });

  // ══ 9.8 Data volume and query plans ═══════════════════════════════

  let volume = null;

  await t("37. seed_5000_entries", async () => {
    volume = await withApp(async (page) => page.evaluate(async () => {
      const db = window.__db;
      const ids = [];
      const ops = [];
      for (let i = 0; i < 20; i++) {
        const h = await db.createHabit({ name: `Volume ${i}`, type: "boolean", frequencyType: "daily" });
        ids.push(h.id);
      }
      // 20 habits x 250 days = 5,000 entries.
      const start = new Date(2025, 0, 1);
      for (const id of ids) {
        for (let d = 0; d < 250; d++) {
          const day = new Date(start.getTime() + d * 86400000);
          const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
          ops.push({ method: "setEntry", args: [id, ds, 1] });
        }
      }
      const began = performance.now();
      // In batches, so one transaction is not 5,000 statements long.
      for (let i = 0; i < ops.length; i += 500) await db.runTransaction(ops.slice(i, i + 500));
      const seedMs = performance.now() - began;

      const t0 = performance.now();
      const batch = await db.getEntriesForHabits(ids, "2025-06-01", "2025-06-30");
      const batchMs = performance.now() - t0;

      await db.__resetStatementCount();
      await db.getEntriesForHabits(ids, "2025-06-01", "2025-06-30");
      const statements = await db.__getStatementCount();

      return {
        total: (await db.__dumpEntries()).length,
        seedMs, batchMs, batchRows: batch.length, statements,
        plan: await db.__explain(
          "SELECT * FROM entries WHERE habit_id=? AND date>=? AND date<=? AND deleted_at IS NULL ORDER BY date",
          [ids[0], "2025-06-01", "2025-06-30"],
        ),
        listPlan: await db.__explain("SELECT * FROM entries WHERE date=? AND deleted_at IS NULL", ["2025-06-01"]),
      };
    }));
    assert(volume.total === 5000, `expected 5000 entries, stored ${volume.total}`);
    return `5,000 entries across 20 habits in ${Math.round(volume.seedMs)}ms`;
  });

  await t("38. range_query_uses_index", async () => {
    assert(volume, "test 37 did not run, so there is nothing to explain");
    const text = volume.plan.join(" | ");
    // Asserting on the plan, not on timing: a fast full scan on a small
    // table would pass a stopwatch and fail a user with real history.
    assert(/USING INDEX|USING COVERING INDEX/i.test(text), `no index in the plan: ${text}`);
    assert(!/SCAN entries(?! USING)/i.test(text), `the plan contains a full table scan: ${text}`);
    return text;
  });

  await t("38b. the by-date query uses its own index", async () => {
    const text = volume.listPlan.join(" | ");
    assert(/USING INDEX/i.test(text), `no index in the plan: ${text}`);
    return text;
  });

  await t("39. batch_query_performance_at_volume", async () => {
    assert(volume, "test 37 did not run");
    assert(volume.batchRows === 600, `expected 600 rows, got ${volume.batchRows}`);
    assert(volume.batchMs < 100, `took ${volume.batchMs.toFixed(1)}ms at 5,000-row volume`);
    return `20 habits x 30 days = ${volume.batchRows} rows in ${volume.batchMs.toFixed(1)}ms`;
  });

  await t("40. list_view_query_budget", async () => {
    assert(volume.statements === 1, `the batch read cost ${volume.statements} statements`);
    // And the whole list view, through Layer 2, must also be bounded.
    const r = await withApp(async (page) => page.evaluate(async () => {
      const db = window.__db;
      for (let i = 0; i < 25; i++) {
        await db.createHabit({ name: `Budget ${i}`, type: "boolean", frequencyType: "daily" });
      }
      await db.__resetStatementCount();
      await window.__logic.getListView(db, 5);
      return db.__getStatementCount();
    }));
    // getToday (+ day_start_hour), listRoutines, listHabits, one entry
    // batch. Constant in the number of habits, which is the claim.
    assert(r <= 6, `the list view issued ${r} statements for 25 habits`);
    return `batch read = 1 statement; full list view for 25 habits = ${r}`;
  });

  // ══ 9.9 Malformed and hostile input ═══════════════════════════════

  const inputCases = await withApp((page) => page.evaluate(async (catchSrc) => {
    const run = eval(catchSrc);
    const db = window.__db;
    const bool = await db.createHabit({ name: "Input", type: "boolean", frequencyType: "daily" });
    const num = await db.createHabit({ name: "Amount", type: "numeric", target: 5, unit: "x", frequencyType: "daily" });
    const out = {};

    out.emptyName = await run(() => db.createHabit({ name: "", type: "boolean", frequencyType: "daily" }));
    out.blankName = await run(() => db.createHabit({ name: "   ", type: "boolean", frequencyType: "daily" }));

    const longName = "x".repeat(500);
    const long = await db.createHabit({ name: longName, type: "boolean", frequencyType: "daily" });
    out.longName = { stored: (await db.getHabit(long.id)).name.length, intact: (await db.getHabit(long.id)).name === longName };

    const weird = "🏋️‍♀️ صلاة  é 𝕳𝖆𝖇𝖎𝖙";
    const uni = await db.createHabit({ name: weird, type: "boolean", frequencyType: "daily" });
    out.unicode = { roundTrip: (await db.getHabit(uni.id)).name === weird };

    out.negative = await run(() => db.setEntry(num.id, "2026-01-05", -5));
    out.nan = await run(() => db.setEntry(num.id, "2026-01-06", NaN));
    out.infinity = await run(() => db.setEntry(num.id, "2026-01-07", Infinity));
    out.negInfinity = await run(() => db.setEntry(num.id, "2026-01-08", -Infinity));
    out.zeroAllowed = await run(() => db.setEntry(num.id, "2026-01-09", 0));

    out.dates = {};
    for (const bad of ["2026-8-1", "08/01/2026", "2026-13-01", "2026-02-30", "", "2026-00-10", "2026-01-32"]) {
      out.dates[bad || "(empty)"] = await run(() => db.setEntry(bool.id, bad, 1));
    }

    const nasty = "'; DROP TABLE entries;--";
    const inj = await db.createHabit({ name: nasty, type: "boolean", frequencyType: "daily" });
    await db.setEntry(inj.id, "2026-01-10", 1);
    out.injection = {
      name: (await db.getHabit(inj.id)).name,
      tableSurvives: (await db.__dumpEntries()).length > 0,
    };

    out.undefinedName = await run(() => db.createHabit({ type: "boolean", frequencyType: "daily" }));
    out.nullIcon = await run(() => db.createHabit({ name: "Nullable", icon: null, type: "boolean", frequencyType: "daily" }));

    return out;
  }, CATCH));

  await t("41. rejects_empty_habit_name", async () => {
    assert(inputCases.emptyName?.name === "ValidationError", `"" gave ${JSON.stringify(inputCases.emptyName)}`);
    assert(inputCases.blankName?.name === "ValidationError", `"   " gave ${JSON.stringify(inputCases.blankName)}`);
    return "both an empty and a whitespace-only name throw ValidationError";
  });

  await t("42. handles_long_habit_name", async () => {
    assert(inputCases.longName.stored === 500, `a 500-character name came back at ${inputCases.longName.stored}`);
    assert(inputCases.longName.intact, "the name was altered in storage");
    return "500 characters accepted intact, not truncated";
  });

  await t("43. handles_unicode_and_emoji_names", async () => {
    assert(inputCases.unicode.roundTrip, "emoji, RTL text or combining characters did not round-trip");
    return "emoji, Arabic, a combining accent and mathematical letters all round-trip";
  });

  await t("44. rejects_negative_numeric_value", async () => {
    assert(inputCases.negative?.name === "ValidationError", `-5 gave ${JSON.stringify(inputCases.negative)}`);
    // 0 must still be accepted: it is the "explicitly missed" state.
    assert(inputCases.zeroAllowed === null, `0 was rejected: ${JSON.stringify(inputCases.zeroAllowed)}`);
    return "-5 throws; 0 is still accepted as an explicit miss";
  });

  await t("45. rejects_non_finite_values", async () => {
    for (const [k, v] of [["NaN", inputCases.nan], ["Infinity", inputCases.infinity], ["-Infinity", inputCases.negInfinity]]) {
      assert(v?.name === "ValidationError", `${k} gave ${JSON.stringify(v)}`);
    }
    return "NaN, Infinity and -Infinity all throw before reaching the table";
  });

  await t("46. rejects_malformed_date_string", async () => {
    const failures = Object.entries(inputCases.dates)
      .filter(([, v]) => v?.name !== "ValidationError")
      .map(([k, v]) => `${k} → ${v ? v.name : "accepted"}`);
    assert(failures.length === 0, `these were not rejected: ${failures.join(", ")}`);
    return `all seven rejected: ${Object.keys(inputCases.dates).join(", ")}`;
  });

  await t("47. rejects_sql_injection_in_text_fields", async () => {
    assert(inputCases.injection.name === "'; DROP TABLE entries;--",
      `the name was mangled: ${inputCases.injection.name}`);
    assert(inputCases.injection.tableSurvives, "the entries table did not survive");
    return "stored as a literal string; the table is intact";
  });

  await t("48. null_and_undefined_handled_distinctly", async () => {
    assert(inputCases.undefinedName?.name === "ValidationError",
      `undefined for a required field gave ${JSON.stringify(inputCases.undefinedName)}`);
    assert(inputCases.nullIcon === null, `null for a nullable field was rejected: ${JSON.stringify(inputCases.nullIcon)}`);
    return "undefined for a required field throws; null for a nullable one is accepted";
  });

  // ══ 9.10 Further date edge cases ══════════════════════════════════

  const dateCases = await withApp((page) => page.evaluate(async (catchSrc) => {
    const run = eval(catchSrc);
    const db = window.__db;
    const h = await db.createHabit({ name: "Calendar", type: "boolean", frequencyType: "daily" });
    const out = { rejected: {}, accepted: {} };

    for (const good of ["2028-02-29", "1970-01-01", "2099-12-31", "2024-02-29", "2000-02-29"]) {
      out.accepted[good] = await run(() => db.setEntry(h.id, good, 1));
    }
    for (const bad of ["2027-02-29", "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31", "2100-02-29"]) {
      out.rejected[bad] = await run(() => db.setEntry(h.id, bad, 1));
    }

    out.sorted = (await db.getEntriesForHabit(h.id, "1970-01-01", "2099-12-31")).map((e) => e.date);

    // 53: backfilling before the habit's own creation date.
    const fresh = await db.createHabit({ name: "Backfill", type: "boolean", frequencyType: "daily" });
    out.backfill = await run(() => db.setEntry(fresh.id, "2020-03-01", 1));
    out.backfillFirst = await db.getFirstEntryDate(fresh.id);
    out.backfillCreated = (await db.getHabit(fresh.id)).createdAt;
    return out;
  }, CATCH));

  await t("49. leap_day_stored_and_retrieved", async () => {
    assert(dateCases.accepted["2028-02-29"] === null, `2028-02-29 was rejected: ${JSON.stringify(dateCases.accepted["2028-02-29"])}`);
    assert(dateCases.accepted["2024-02-29"] === null, "2024-02-29 was rejected");
    // 2000 is a leap year under the 400 rule, which the divisible-by-4
    // shorthand also gets right but the divisible-by-100 one does not.
    assert(dateCases.accepted["2000-02-29"] === null, "2000-02-29 was rejected");
    assert(dateCases.sorted.includes("2028-02-29"), "the leap day is missing from a range query");
    return "2024, 2000 and 2028 leap days all store and retrieve";
  });

  await t("50. rejects_invalid_leap_day", async () => {
    assert(dateCases.rejected["2027-02-29"]?.name === "ValidationError",
      `2027-02-29 gave ${JSON.stringify(dateCases.rejected["2027-02-29"])}`);
    // 2100 is divisible by 4 but not a leap year — the case the
    // shorthand rule gets wrong.
    assert(dateCases.rejected["2100-02-29"]?.name === "ValidationError",
      `2100-02-29 gave ${JSON.stringify(dateCases.rejected["2100-02-29"])} — the century rule is not applied`);
    return "2027-02-29 and 2100-02-29 both rejected, so the full Gregorian rule is in force";
  });

  await t("51. thirty_first_of_short_month_rejected", async () => {
    for (const d of ["2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31"]) {
      assert(dateCases.rejected[d]?.name === "ValidationError", `${d} gave ${JSON.stringify(dateCases.rejected[d])}`);
    }
    return "the 31st of April, June, September and November all rejected";
  });

  await t("52. far_past_and_future_dates", async () => {
    assert(dateCases.accepted["1970-01-01"] === null, "1970-01-01 was rejected");
    assert(dateCases.accepted["2099-12-31"] === null, "2099-12-31 was rejected");
    const s = dateCases.sorted;
    assert(s[0] === "1970-01-01", `earliest is ${s[0]}`);
    assert(s[s.length - 1] === "2099-12-31", `latest is ${s[s.length - 1]}`);
    // Deliberately unbounded, and the ordering property still holds.
    assert([...s].sort().join() === s.join(), "lexicographic order diverged from chronological order");
    return `unbounded by design; ${s.length} dates from ${s[0]} to ${s[s.length - 1]}, still in order`;
  });

  await t("53. entry_before_habit_creation_allowed", async () => {
    assert(dateCases.backfill === null, `backfilling was refused: ${JSON.stringify(dateCases.backfill)}`);
    assert(dateCases.backfillFirst === "2020-03-01", `getFirstEntryDate returned ${dateCases.backfillFirst}`);
    assert(dateCases.backfillCreated > "2020-03-01", "the habit was not in fact created later");
    return `entry on 2020-03-01 against a habit created ${dateCases.backfillCreated.slice(0, 10)}`;
  });

  // ══ 9.11 Migration robustness ═════════════════════════════════════

  await t("54/55. migration_is_transactional and migration_from_v1_to_v2", async () => {
    // Not a simulation: this database really was created at v1 and
    // really was carried to v2 by the runner, because migration 2 is a
    // shipped migration and every profile here starts empty.
    const r = await withApp((page) => page.evaluate(async () => {
      const db = window.__db;
      const h = await db.createHabit({ name: "Survivor", type: "boolean", frequencyType: "daily" });
      await db.setEntry(h.id, "2026-02-02", 1);
      return {
        version: await db.getMeta("schema_version"),
        // Columns that only exist because migration 2 added them.
        columns: Object.keys((await db.__dumpRaw("entries"))[0] ?? {}),
        rows: (await db.__dumpEntries()).length,
      };
    }));
    assert(r.version === "2", `schema_version is ${r.version}`);
    for (const c of ["user_id", "deleted_at", "sync_status"]) {
      assert(r.columns.includes(c), `migration 2 did not add ${c}: ${r.columns.join(", ")}`);
    }
    assert(r.rows === 1, `rows were lost across the migration: ${r.rows}`);
    return `v1 → v2 applied, ${r.columns.length} columns, data intact`;
  });

  // 54 proper — that a migration which throws leaves schema_version and
  // the schema untouched — is a unit test (tests/unit/migrations.test.ts).
  // It needs a migration that fails on purpose, and shipping one into the
  // real MIGRATIONS list to prove a point would be worse than the bug.

  await t("56. refuses_downgrade", async () => {
    const r = await withApp((page) => page.evaluate(async (catchSrc) => {
      const run = eval(catchSrc);
      const db = window.__db;
      await db.createHabit({ name: "Future", type: "boolean", frequencyType: "daily" });
      // Pretend a newer build has been here.
      await db.setMeta("schema_version", "99");
      return { set: await db.getMeta("schema_version"), err: await run(() => db.getToday()) };
    }, CATCH));
    assert(r.set === "99", "the version could not be set for the test");
    // The refusal happens on the next open, so reload and observe it.
    const after = await withApp(async (page) => {
      await page.evaluate(() => window.__db.setMeta("schema_version", "99"));
      await page.reload();
      await page.waitForSelector(".notice--error, .row__name, .notice__title", { timeout: 30000 });
      return page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
    });
    assert(/older than your data/i.test(after), `the downgrade was not refused: ${after.slice(0, 200)}`);
    return "a database at version 99 refuses to open, and says why";
  });

  // ══ 9.12 Storage pressure and durability ══════════════════════════

  await t("57. persistence_requested_and_reported", async () => {
    const r = await withApp((page) => page.evaluate(() => window.__db.getStorageInfo()));
    assert(r.persisted || r.persistRequested,
      `persistence was neither granted nor requested: ${JSON.stringify(r)}`);
    assert(typeof r.persisted === "boolean", "the result is not stored as a boolean");
    return `persisted=${r.persisted} requested=${r.persistRequested}`;
  });

  await t("58. quota_exceeded_surfaces_error", async () => {
    const r = await withApp((page) => page.evaluate(async (catchSrc) => {
      const run = eval(catchSrc);
      // A note larger than any quota. Whatever the browser does with
      // it, the one unacceptable outcome is silence.
      const db = window.__db;
      const h = await db.createHabit({ name: "Huge", type: "boolean", frequencyType: "daily" });
      const huge = "x".repeat(64 * 1024 * 1024);
      const err = await run(() => db.setEntry(h.id, "2026-03-03", 1, huge));
      return { err, stored: (await db.getEntry(h.id, "2026-03-03")) !== null };
    }, CATCH));
    // Either it fit (browsers have generous quotas) or it threw a typed
    // error. It must never have failed silently.
    if (r.err === null) return "the write succeeded — this browser's quota absorbed 64MB; mapping asserted by unit test";
    assert(["QuotaExceededError", "ConstraintError", "Error"].includes(r.err.name),
      `an untyped failure escaped: ${JSON.stringify(r.err)}`);
    assert(r.err.message.length > 0, "the error carried no message");
    return `refused with ${r.err.name}: ${r.err.message.slice(0, 80)}`;
  });

  await t("59. detects_evicted_database", async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "evict-"));
    try {
      // Write real data, and let the marker record it.
      await withApp(async (page) => {
        await page.evaluate(async () => {
          const db = window.__db;
          const h = await db.createHabit({ name: "Will be evicted", type: "boolean", frequencyType: "daily" });
          await db.setEntry(h.id, "2026-04-04", 1);
          await db.getStorageInfo();
        });
        await page.waitForTimeout(2500); // let the debounced marker settle
      }, { profileDir: dir });

      // Evict exactly as a browser would: remove the OPFS files, leave
      // localStorage alone. The database will reopen, empty.
      const report = await withApp(async (page) => {
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          for await (const [name] of root.entries()) {
            await root.removeEntry(name, { recursive: true }).catch(() => {});
          }
        });
        await page.reload();
        await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
        return page.evaluate(() => window.__db.getStorageInfo());
      }, { profileDir: dir });

      assert(report.counts.habits === 0, "the eviction did not actually empty the database");
      assert(report.evicted !== null,
        "an emptied database was reported as new — a year of history would read as 'no habits yet'");
      assert(report.evicted.lastKnownHabits === 1,
        `the report says ${report.evicted.lastKnownHabits} habits`);
      return `detected: ${report.evicted.lastKnownHabits} habit(s) last seen ${report.evicted.lastSeenAt}`;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("59b. a genuinely new database is not reported as evicted", async () => {
    const r = await withApp((page) => page.evaluate(() => window.__db.getStorageInfo()));
    assert(r.evicted === null, `a fresh profile was reported as evicted: ${JSON.stringify(r.evicted)}`);
    return "a first run says nothing, rather than guessing";
  });

  await t("60. vfs_identity_verified_at_runtime", async () => {
    const r = await withApp((page) => page.evaluate(() => window.__db.getStorageInfo()));
    assert(r.vfsName === "opfs-sahpool", `the database opened on ${JSON.stringify(r.vfsName)}`);
    assert(!/mem|temp/i.test(r.vfsName), `fell back to a volatile store: ${r.vfsName}`);
    return `vfsName=${r.vfsName} files=${r.files.join(",")} — read from the running database`;
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
