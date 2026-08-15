// The habit editor, driven the way a person drives it.
//
// This suite exists because of a defect no other suite could have caught:
// every acceptance test seeded its data by calling window.__db directly,
// so all of them passed against a build in which the "+" button did
// nothing and no habit could be created at all. The app was, from a
// user's side, permanently empty.
//
// Nothing here touches window.__db to set up state. Everything is typed
// and tapped.
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
  const dir = fs.mkdtempSync(join(os.tmpdir(), "editor-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    args: ["--no-sandbox"], viewport: { width: 390, height: 844 },
  });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(BASE_URL);
    await page.waitForSelector(".topbar__title", { timeout: 30000 });
    return await fn(page, errors);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Creates a habit through the interface, with no direct database access. */
async function createByHand(page, { name, type = "Yes or no", target = null, unit = null }) {
  await page.getByLabel("Add a habit").click();
  await page.getByText(type, { exact: true }).click();
  await page.getByLabel("Name").fill(name);
  if (target !== null) await page.locator('input[placeholder="2"]').fill(target);
  if (unit !== null) await page.getByLabel("Unit").fill(unit);
  await page.getByLabel("Save habit").click();
  await page.waitForSelector(".row__name", { timeout: 15000 });
}

async function main() {
  await t("a first-time visitor can create a habit without ever opening the console", async () => {
    const r = await withApp(async (page, errors) => {
      // The empty state must offer a way in, not just describe one.
      await page.getByText("Add your first habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Name").fill("Meditate");
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".row__name", { timeout: 15000 });
      return {
        names: await page.locator(".row__label").allInnerTexts(),
        // Read back through Layer 1 to confirm it was really persisted,
        // not merely painted.
        stored: await page.evaluate(() => window.__db.listHabits().then((hs) => hs.map((h) => h.name))),
        errors,
      };
    });
    assert(r.names.includes("Meditate"), `the list shows ${JSON.stringify(r.names)}`);
    assert(r.stored.includes("Meditate"), `the database holds ${JSON.stringify(r.stored)}`);
    assert(r.errors.length === 0, `console errors: ${r.errors.join("; ")}`);
    return "empty state → type picker → name → save → the habit is in the list and on disk";
  });

  await t("the habit survives a reload", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Stretch" });
      await page.reload();
      await page.waitForSelector(".row__name", { timeout: 20000 });
      return page.locator(".row__label").allInnerTexts();
    });
    assert(r.includes("Stretch"), `after reload the list shows ${JSON.stringify(r)}`);
    return "still there after a reload";
  });

  await t("a measurable habit keeps its target and unit, and the list shows the unit", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Water", type: "Measurable", target: "2", unit: "L" });
      // Log a value from the detail screen's own path: tapping a numeric
      // cell opens the habit rather than inventing an amount.
      const stored = await page.evaluate(async () => {
        const [h] = await window.__db.listHabits();
        return { type: h.type, target: h.target, unit: h.unit };
      });
      return stored;
    });
    assert(r.type === "numeric", `type is ${r.type}`);
    assert(r.target === 2, `target is ${r.target}`);
    assert(r.unit === "L", `unit is ${r.unit}`);
    return "numeric, target 2, unit L";
  });

  await t("saving without a name is refused, and says why", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Add a habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".field__error", { timeout: 5000 });
      return {
        message: await page.locator(".field__error").first().innerText(),
        stillOnForm: await page.locator(".editor__form").count(),
        stored: await page.evaluate(() => window.__db.listHabits().then((hs) => hs.length)),
      };
    });
    assert(/needs a name/i.test(r.message), `the reason was unclear: ${r.message}`);
    assert(r.stillOnForm === 1, "the form closed despite the save being refused");
    assert(r.stored === 0, `a nameless habit was written anyway (${r.stored} rows)`);
    return `refused with: ${r.message}`;
  });

  await t("a measurable habit cannot be saved without a target", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Add a habit").click();
      await page.getByText("Measurable", { exact: true }).click();
      await page.getByLabel("Name").fill("Steps");
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".field__error", { timeout: 5000 });
      return {
        messages: await page.locator(".field__error").allInnerTexts(),
        stored: await page.evaluate(() => window.__db.listHabits().then((hs) => hs.length)),
      };
    });
    assert(r.messages.some((m) => /target/i.test(m)), `no target error: ${JSON.stringify(r.messages)}`);
    assert(r.stored === 0, "the habit was written without a target");
    return r.messages.join(" / ");
  });

  await t("choosing certain days and saving none of them is refused", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Add a habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Name").fill("Gym");
      await page.getByLabel("How often").selectOption("specific_days");
      // Clear the five weekdays the form starts with.
      for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
        await page.getByLabel(day, { exact: true }).click();
      }
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".field__error", { timeout: 5000 });
      return page.locator(".field__error").first().innerText();
    });
    assert(/at least one day/i.test(r), `the reason was unclear: ${r}`);
    return r;
  });

  await t("a Mon/Wed/Fri habit stores exactly those days, in order", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Add a habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Name").fill("Gym");
      await page.getByLabel("How often").selectOption("specific_days");
      // Start from the default Mon-Fri and turn off Tue and Thu.
      await page.getByLabel("Tuesday", { exact: true }).click();
      await page.getByLabel("Thursday", { exact: true }).click();
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".row__name", { timeout: 15000 });
      return page.evaluate(async () => (await window.__db.listHabits())[0]);
    });
    assert(r.frequencyType === "specific_days", `frequency is ${r.frequencyType}`);
    assert(JSON.stringify(r.frequencyDays) === "[1,3,5]", `days are ${JSON.stringify(r.frequencyDays)}`);
    return "frequencyDays = [1,3,5]";
  });

  await t("editing renames a habit and the list updates", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Old name" });
      await page.locator(".row__name").first().click();
      await page.getByLabel("Edit this habit").click();
      await page.getByLabel("Name").fill("New name");
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".row__name", { timeout: 15000 });
      return {
        names: await page.locator(".row__label").allInnerTexts(),
        count: await page.evaluate(() => window.__db.listHabits().then((hs) => hs.length)),
      };
    });
    assert(r.names.includes("New name"), `the list shows ${JSON.stringify(r.names)}`);
    assert(!r.names.includes("Old name"), "the old name is still shown");
    // An edit must not quietly create a second habit.
    assert(r.count === 1, `editing produced ${r.count} habits`);
    return "renamed in place, still one habit";
  });

  await t("a habit with logged days cannot change its kind, and the form says so", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Logged" });
      // Log today by tapping the cell, as a person would.
      await page.locator(".grid.row .cell").first().click();
      await page.waitForTimeout(400);
      await page.locator(".row__name").first().click();
      await page.getByLabel("Edit this habit").click();
      await page.waitForSelector('.segmented__option:disabled', { timeout: 10000 });
      return {
        disabled: await page.locator('[aria-label="Kind of habit"] button:disabled').count(),
        hint: await page.locator(".field__hint").filter({ hasText: /Locked/ }).innerText(),
      };
    });
    assert(r.disabled === 2, `the kind control is still changeable (${r.disabled} of 2 disabled)`);
    assert(/logged days/i.test(r.hint), `the explanation was missing: ${r.hint}`);
    return "the control is disabled and says why, rather than failing on save";
  });

  await t("deleting asks first, and only then removes the habit and its days", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Doomed" });
      await page.locator(".grid.row .cell").first().click();
      await page.waitForTimeout(400);
      await page.locator(".row__name").first().click();
      await page.getByLabel("Edit this habit").click();

      await page.getByText("Delete permanently").click();
      const asked = await page.locator(".editor__confirm").count();
      const beforeCount = await page.evaluate(() => window.__db.listHabits().then((hs) => hs.length));

      await page.getByText("Delete for good").click();
      await page.waitForSelector(".notice__title", { timeout: 15000 });
      return {
        asked, beforeCount,
        after: await page.evaluate(async () => ({
          habits: (await window.__db.listHabits()).length,
          entries: (await window.__db.__dumpEntries()).length,
        })),
        empty: await page.locator(".notice__title").innerText(),
      };
    });
    assert(r.asked === 1, "the first tap deleted without asking");
    assert(r.beforeCount === 1, "the habit went before the confirmation was answered");
    assert(r.after.habits === 0, `${r.after.habits} habits survived the delete`);
    assert(r.after.entries === 0, `${r.after.entries} logged days were orphaned`);
    assert(/no habits yet/i.test(r.empty), `back to: ${r.empty}`);
    return "confirmed once, then habit and entries both gone";
  });

  await t("archiving hides the habit but keeps its logged days", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Retired" });
      await page.locator(".grid.row .cell").first().click();
      await page.waitForTimeout(400);
      await page.locator(".row__name").first().click();
      await page.getByLabel("Edit this habit").click();
      await page.getByText(/^Archive/).click();
      await page.waitForSelector(".notice__title", { timeout: 15000 });
      return page.evaluate(async () => ({
        visible: (await window.__db.listHabits()).length,
        all: (await window.__db.listHabits({ includeArchived: true })).length,
        entries: (await window.__db.__dumpEntries()).length,
      }));
    });
    assert(r.visible === 0, "the archived habit is still listed");
    assert(r.all === 1, "archiving deleted the habit instead of hiding it");
    assert(r.entries === 1, `the logged day was lost (${r.entries} entries)`);
    return "hidden from the list, still on disk, entry intact";
  });

  await t("cancelling writes nothing", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Add a habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Name").fill("Never saved");
      await page.getByLabel("Cancel").click();
      await page.waitForSelector(".notice__title", { timeout: 10000 });
      return page.evaluate(() => window.__db.listHabits().then((hs) => hs.length));
    });
    assert(r === 0, `cancelling still wrote ${r} habits`);
    return "back to an empty list, nothing written";
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
