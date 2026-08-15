// Cross-origin isolation bootstrap test.
//
// This exists because a real deployment shipped broken while every other
// suite was green. Those suites all reused a browser that had already
// been isolated, so none of them exercised the one path a first-time
// visitor takes: a brand-new profile, no service worker yet, on a host
// that sends no COOP/COEP headers of its own.
//
// The failure it guards against: keying the post-install reload on
// `navigator.serviceWorker.ready` rather than on the worker actually
// CONTROLLING the page. Readiness resolves while the current page is
// still uncontrolled, so a single reload can land before the worker is
// driving and the page stays unisolated — permanently, if the retry is
// one-shot. The app then correctly refuses to open the database, and
// the user sees an error card instead of their habits.
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

/** A profile no browser has ever used, exactly like a first-time visitor. */
async function withFreshProfile(fn) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "coi-"));
  const ctx = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const state = (page) => page.evaluate(() => ({
  isolated: window.crossOriginIsolated,
  sab: typeof SharedArrayBuffer !== "undefined",
  controlled: !!navigator.serviceWorker.controller,
  hasDb: !!window.__db,
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 160),
}));

async function main() {
  await t("a first-time visitor reaches cross-origin isolation unaided", async () => {
    const s = await withFreshProfile(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(BASE_URL);
      // Register, take control, reload. Generous, since a phone on a
      // slow connection is the case that actually broke.
      await page.waitForTimeout(8000);
      return state(page);
    });
    assert(s.isolated, `crossOriginIsolated is false — the page never became isolated (${s.text})`);
    assert(s.sab, "SharedArrayBuffer is unavailable, so the OPFS VFS cannot run");
    assert(s.controlled, "no service worker is controlling the page");
    return "isolated, SharedArrayBuffer present, worker controlling";
  });

  await t("the database opens and persists for that same first-time visitor", async () => {
    const r = await withFreshProfile(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(BASE_URL);
      await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
      const written = await page.evaluate(async () => {
        const db = window.__db;
        const h = await db.createHabit({ name: "Isolation check", type: "boolean", frequencyType: "daily" });
        await db.setEntry(h.id, await db.getToday(), 1);
        return h.id;
      });
      // Reload: OPFS must hand the same data back.
      await page.goto(BASE_URL);
      await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
      return page.evaluate(async (id) => ({
        habits: (await window.__db.listHabits()).map((h) => h.name),
        entry: await window.__db.getEntry(id, await window.__db.getToday()),
      }), written);
    });
    assert(r.habits.includes("Isolation check"), `habit did not persist: ${JSON.stringify(r.habits)}`);
    assert(r.entry?.value === 1, `entry did not persist: ${JSON.stringify(r.entry)}`);
    return "wrote a habit, reloaded, read it back";
  });

  await t("the error card never appears on a healthy first load", async () => {
    const s = await withFreshProfile(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(BASE_URL);
      await page.waitForTimeout(8000);
      return state(page);
    });
    assert(!s.text.includes("Could not open your habits"),
      `the storage error was shown to a first-time visitor: ${s.text}`);
    return "the list rendered instead of the storage error";
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
