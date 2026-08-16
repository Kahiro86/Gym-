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

  // ── Screen 1's top bar and grid ───────────────────────────────────

  await t("habit rows line up with their day-column headers", async () => {
    // The regression this guards: HabitEditor.css defined `.row`, which
    // ListScreen.css already used for a habit row. The editor's
    // `display: flex` won on source order, so the grid collapsed — the
    // name squashed to one letter and the cells bunched at the left,
    // nowhere near the columns they belonged to.
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Alignment check" });
      return page.evaluate(() => {
        const centre = (el) => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; };
        return {
          headers: [...document.querySelectorAll(".colheader__day")].map(centre),
          cells: [...document.querySelectorAll(".grid.row .cell")].map(centre),
          nameWidth: document.querySelector(".row__name").getBoundingClientRect().width,
          label: document.querySelector(".row__label").innerText,
        };
      });
    });
    assert(r.cells.length === r.headers.length,
      `${r.cells.length} cells against ${r.headers.length} columns`);
    for (let i = 0; i < r.cells.length; i++) {
      assert(Math.abs(r.cells[i] - r.headers[i]) < 1.5,
        `cell ${i} sits at ${r.cells[i].toFixed(1)}px, its column header at ${r.headers[i].toFixed(1)}px`);
    }
    // The name column must be wide enough to be a name, not an initial.
    assert(r.nameWidth > 90, `the name column collapsed to ${r.nameWidth.toFixed(0)}px`);
    assert(r.label === "Alignment check", `the name rendered as "${r.label}"`);
    return `${r.cells.length} cells centred on their headers; name column ${r.nameWidth.toFixed(0)}px`;
  });

  await t("a scheduled day with nothing logged is visibly tappable", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Daily" });
      return page.evaluate(() => ({
        // Today gets the gold ring; the four past days are scheduled but
        // unlogged, and must not be indistinguishable from a day off.
        rings: document.querySelectorAll(".cell__ring").length,
        todo: document.querySelectorAll(".cell__todo").length,
      }));
    });
    assert(r.rings === 1, `expected one ring on today, found ${r.rings}`);
    assert(r.todo === 4, `expected four tappable past days marked, found ${r.todo}`);
    return "today ringed, the other four scheduled days marked";
  });

  await t("a day the habit is not due carries no mark at all", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Add a habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Name").fill("Weekdays only");
      await page.getByLabel("How often").selectOption("specific_days");
      // Monday only, so at most one of the five columns is scheduled.
      for (const d of ["Tuesday", "Wednesday", "Thursday", "Friday"]) {
        await page.getByLabel(d, { exact: true }).click();
      }
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".row__name", { timeout: 15000 });
      return page.evaluate(() => ({
        off: document.querySelectorAll(".cell--off").length,
        offWithMark: [...document.querySelectorAll(".cell--off")]
          .filter((c) => c.querySelector(".cell__todo, .cell__ring")).length,
      }));
    });
    assert(r.off >= 4, `expected at least four days off, found ${r.off}`);
    assert(r.offWithMark === 0, `${r.offWithMark} days off were marked as if they were tappable`);
    return `${r.off} days off, none of them marked`;
  });

  await t("the filter hides habits done today, and says the list is filtered", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Done" });
      await createByHand(page, { name: "Not done" });
      // Tick today on the first habit only.
      await page.locator(".grid.row").first().locator(".cell").first().click();
      await page.waitForTimeout(400);

      await page.getByLabel("Filter").click();
      await page.getByText("Hide done today").click();
      await page.waitForTimeout(500);
      const filtered = await page.locator(".row__label").allInnerTexts();
      const marked = await page.locator(".topbar__action--on").count();

      await page.getByText("Hide done today").click();
      await page.waitForTimeout(500);
      return { filtered, marked, restored: await page.locator(".row__label").allInnerTexts() };
    });
    assert(!r.filtered.includes("Done"), `the completed habit is still listed: ${JSON.stringify(r.filtered)}`);
    assert(r.filtered.includes("Not done"), `the outstanding habit vanished: ${JSON.stringify(r.filtered)}`);
    // Without this, an empty list looks like data loss.
    assert(r.marked === 1, "nothing indicated that a filter was hiding habits");
    assert(r.restored.length === 2, `turning the filter off did not restore both: ${JSON.stringify(r.restored)}`);
    return `filtered to ${JSON.stringify(r.filtered)}, filter icon marked, restored on toggle off`;
  });

  await t("the filter can show archived habits, labelled as archived", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Retired" });
      await page.locator(".row__name").first().click();
      await page.getByLabel("Edit this habit").click();
      await page.getByText(/^Archive/).click();
      await page.waitForSelector(".notice__title", { timeout: 15000 });

      const hidden = await page.locator(".row__label").count();
      await page.getByLabel("Filter").click();
      await page.getByText("Show archived").click();
      await page.waitForSelector(".row__label", { timeout: 15000 });
      return {
        hidden,
        shown: await page.locator(".row__label").allInnerTexts(),
        labelled: await page.locator(".row__archived").count(),
      };
    });
    assert(r.hidden === 0, "the archived habit was listed without asking");
    assert(r.shown.includes("Retired"), `the filter did not reveal it: ${JSON.stringify(r.shown)}`);
    assert(r.labelled === 1, "it was shown without being marked as archived");
    return "hidden by default, shown and labelled when asked for";
  });

  await t("an empty list caused by a filter does not claim you have no habits", async () => {
    const r = await withApp(async (page) => {
      await createByHand(page, { name: "Only one" });
      await page.locator(".grid.row").first().locator(".cell").first().click();
      await page.waitForTimeout(400);
      await page.getByLabel("Filter").click();
      await page.getByText("Hide done today").click();
      // Dismiss the sheet the way a person would before reading the list
      // underneath it — its backdrop is the tap-to-close target.
      await page.keyboard.press("Escape");
      await page.waitForSelector(".notice__title", { timeout: 10000 });
      const title = await page.locator(".notice__title").innerText();
      await page.getByText("Clear the filter").click();
      await page.waitForSelector(".row__label", { timeout: 10000 });
      return { title, restored: await page.locator(".row__label").allInnerTexts() };
    });
    assert(/nothing matches/i.test(r.title),
      `an empty filtered list said "${r.title}", which reads as data loss`);
    assert(r.restored.includes("Only one"), "clearing the filter did not bring the habit back");
    return `"${r.title}", and clearing it restores the list`;
  });

  await t("the overflow menu creates a group, which the editor can then use", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("More").click();
      await page.getByLabel("New group").fill("Morning");
      await page.getByText("Add", { exact: true }).click();
      await page.waitForTimeout(600);

      // The new group has to be selectable when making a habit.
      await page.getByLabel("Add a habit").click();
      await page.getByText("Yes or no", { exact: true }).click();
      await page.getByLabel("Name").fill("Meditate");
      await page.getByLabel("Group").selectOption({ label: "Morning" });
      await page.getByLabel("Save habit").click();
      await page.waitForSelector(".row__name", { timeout: 15000 });
      return {
        groups: await page.locator(".group").allInnerTexts(),
        stored: await page.evaluate(() => window.__db.listRoutines().then((rs) => rs.map((x) => x.name))),
      };
    });
    assert(r.stored.includes("Morning"), `the group was not saved: ${JSON.stringify(r.stored)}`);
    assert(r.groups.some((g) => /morning/i.test(g)),
      `the habit did not appear under its group: ${JSON.stringify(r.groups)}`);
    return "group created from the menu, then used as a habit's group";
  });

  await t("the overflow menu changes the day-start hour and reports storage", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("More").click();
      await page.getByLabel("The day starts at").selectOption("6");
      await page.waitForTimeout(500);
      const storage = await page.locator(".sheet__section").last().innerText();
      // Reopen to confirm it was persisted, not just held in the form.
      await page.keyboard.press("Escape");
      await page.getByLabel("More").click();
      return {
        stored: await page.evaluate(() => window.__db.getDayStartHour()),
        shown: await page.getByLabel("The day starts at").inputValue(),
        storage,
      };
    });
    assert(r.stored === 6, `day_start_hour is ${r.stored}`);
    assert(r.shown === "6", `the menu reopened showing ${r.shown}`);
    assert(/opfs-sahpool/.test(r.storage), `storage was not reported: ${r.storage}`);
    return `day starts at 06:00; storage line reads back the live VFS`;
  });

  await t("a menu closes on Escape and on a tap outside it", async () => {
    const r = await withApp(async (page) => {
      await page.getByLabel("Filter").click();
      const opened = await page.locator(".sheet").count();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const afterEscape = await page.locator(".sheet").count();

      await page.getByLabel("More").click();
      await page.locator(".sheet__backdrop").click({ position: { x: 5, y: 700 } });
      await page.waitForTimeout(200);
      return { opened, afterEscape, afterBackdrop: await page.locator(".sheet").count() };
    });
    assert(r.opened === 1, "the filter menu did not open");
    assert(r.afterEscape === 0, "Escape left the menu open");
    assert(r.afterBackdrop === 0, "tapping outside left the menu open");
    return "opens, then closes on Escape and on an outside tap";
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
