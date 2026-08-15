// Layer 1b §9.2 — local storage.
//
// These exist because a deployment shipped broken while every other suite
// was green: the suites all reused a browser that had already been made
// cross-origin isolated, so none of them took the path a first-time
// visitor takes. Each test here starts from a profile no browser has ever
// used, on a server that sends no special headers, exactly as GitHub
// Pages serves it.
//
// The claims about which VFS is in use are read back from the running
// database, never asserted from the source, because the failure being
// guarded against is precisely a silent fallback to something else.
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
  const dir = fs.mkdtempSync(join(os.tmpdir(), "habits-"));
  const ctx = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
  try {
    return await fn(ctx, dir);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Opens the app and waits for the database to be reachable. */
async function open(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.__db, null, { timeout: 30000 });
  return page;
}

async function main() {
  await t("1. the database opens on the OPFS pool VFS, reported by the running app", async () => {
    const info = await withFreshProfile(async (ctx) => {
      const page = await open(ctx);
      return page.evaluate(() => window.__db.getStorageInfo());
    });
    assert(info.vfsName === "opfs-sahpool",
      `expected the "opfs-sahpool" VFS, got ${JSON.stringify(info.vfsName)}`);
    // The failure this rules out: quietly opening a database that
    // evaporates on reload, which looks fine until the user comes back.
    assert(!/mem|temp/i.test(info.vfsName), `fell back to a volatile VFS: ${info.vfsName}`);
    assert(info.files.length > 0, "the VFS reports no files, so nothing was persisted");
    return `vfsName=${info.vfsName}  files=${info.files.join(",")}`;
  });

  await t("1b. an unopenable VFS fails loudly instead of falling back", async () => {
    // Sabotage from outside the app: put a plain FILE where the pool
    // needs its DIRECTORY. Chromium has no switch for turning OPFS off,
    // and Playwright's init scripts do not reach a Worker, so this is
    // the way to make the real install fail for a real reason rather
    // than stubbing the code under test.
    const r = await withFreshProfile(async (ctx) => {
      const page = await ctx.newPage();
      // A 404 on the same origin: no app, but OPFS is reachable.
      await page.goto(`${BASE_URL}__setup`);
      const planted = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        await root.getFileHandle(".opfs-sahpool", { create: true });
        return true;
      });
      if (!planted) throw new Error("could not plant the blocking file");

      await page.goto(BASE_URL);
      await page.waitForSelector(".notice--error", { timeout: 30000 });
      return page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    });
    assert(/Refusing to fall back/i.test(r), `the refusal was not surfaced: ${r.slice(0, 300)}`);
    return "the error card names the real cause and refuses an in-memory database";
  });

  await t("2. navigator.storage.persist() is requested on first run and its result surfaced", async () => {
    const info = await withFreshProfile(async (ctx) => {
      const page = await open(ctx);
      return page.evaluate(() => window.__db.getStorageInfo());
    });
    // Either it was already granted, or we asked. What must never happen
    // is neither: silently accepting evictable storage for the source of
    // truth between syncs.
    assert(info.persisted || info.persistRequested,
      `persistence was neither granted nor requested: ${JSON.stringify(info)}`);
    return `persisted=${info.persisted}  requested=${info.persistRequested}`;
  });

  await t("6. data survives a full browser restart", async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "habits-restart-"));
    try {
      const first = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
      const id = await (async () => {
        const page = await open(first);
        return page.evaluate(async () => {
          const h = await window.__db.createHabit({ name: "Survives restart", type: "boolean", frequencyType: "daily" });
          await window.__db.setEntry(h.id, await window.__db.getToday(), 1);
          return h.id;
        });
      })();
      await first.close();

      // A genuinely new browser process against the same profile — not a
      // reload, which a purely in-memory database could also survive if
      // the worker outlived the page.
      const second = await chromium.launchPersistentContext(dir, { args: ["--no-sandbox"] });
      const read = await (async () => {
        const page = await open(second);
        return page.evaluate(async (habitId) => ({
          names: (await window.__db.listHabits()).map((h) => h.name),
          entry: await window.__db.getEntry(habitId, await window.__db.getToday()),
          vfs: (await window.__db.getStorageInfo()).vfsName,
        }), id);
      })();
      await second.close();

      assert(read.names.includes("Survives restart"), `habit lost: ${JSON.stringify(read.names)}`);
      assert(read.entry?.value === 1, `entry lost: ${JSON.stringify(read.entry)}`);
      return `read back from ${read.vfs} in a new browser process`;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("9. a second tab cannot corrupt the database — the writer lock refuses it", async () => {
    const r = await withFreshProfile(async (ctx) => {
      const a = await open(ctx);
      await a.evaluate(() => window.__db.createHabit({ name: "Tab A", type: "boolean", frequencyType: "daily" }));

      // Tab B opens while A still holds the lock. The pool VFS takes
      // exclusive handles, so B genuinely cannot write; the requirement
      // is that it says so rather than half-opening something.
      const b = await ctx.newPage();
      await b.goto(BASE_URL);
      await b.waitForSelector(".notice--error", { timeout: 30000 });
      const message = await b.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
      await b.close();

      // A is unaffected and its data is intact.
      const stillWorks = await a.evaluate(async () => {
        await window.__db.createHabit({ name: "Tab A again", type: "boolean", frequencyType: "daily" });
        return (await window.__db.listHabits()).map((h) => h.name);
      });
      await a.close();

      // With A gone the lock is free, and a new tab opens normally.
      const c = await open(ctx);
      const afterClose = await c.evaluate(() => window.__db.listHabits().then((hs) => hs.map((h) => h.name)));
      return { message, stillWorks, afterClose };
    });
    assert(/another tab/i.test(r.message), `the second tab's refusal was unclear: ${r.message.slice(0, 300)}`);
    assert(r.stillWorks.includes("Tab A") && r.stillWorks.includes("Tab A again"),
      `the first tab was disrupted: ${JSON.stringify(r.stillWorks)}`);
    assert(r.afterClose.includes("Tab A") && r.afterClose.includes("Tab A again"),
      `data did not survive the handover: ${JSON.stringify(r.afterClose)}`);
    return "second tab refused with a truthful message; first tab unaffected; handover clean";
  });

  await t("no service worker and no cross-origin isolation are required", async () => {
    const s = await withFreshProfile(async (ctx) => {
      const page = await open(ctx);
      return page.evaluate(() => ({
        isolated: window.crossOriginIsolated,
        workers: navigator.serviceWorker.controller ? 1 : 0,
        text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
      }));
    });
    // The point of the whole change: this works on a plain static host.
    assert(!s.isolated, "the test server is sending isolation headers, so this proves nothing");
    assert(s.workers === 0, "a service worker is controlling the page; the dependency was not removed");
    assert(!s.text.includes("Could not open your habits"), `storage error shown: ${s.text}`);
    return "opened on an unisolated, uncontrolled page";
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
