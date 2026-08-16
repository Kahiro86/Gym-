// Guards against a defect that shipped: HabitEditor.css defined `.row`,
// ListScreen.css already used `.row` for a habit row, and every
// stylesheet is bundled into one document. The editor's `display: flex`
// won on source order and collapsed the habit grid — names squashed to a
// letter, day cells no longer under their column headers.
//
// Nothing caught it. Typecheck cannot see CSS, and every screen still
// rendered, so the acceptance suites passed against a visibly broken
// list. These files are hand-written CSS rather than modules, so the
// discipline that replaces scoping is: a class belongs to exactly one
// stylesheet, unless it is deliberately shared.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/ui");

/**
 * Classes intentionally shared between screens. Every one of these is a
 * layout primitive that means the same thing everywhere it appears; the
 * definition lives in the file named here, and other screens only use it.
 */
const SHARED: Record<string, string> = {
  screen: "ListScreen.css",
  notice: "ListScreen.css",
  "notice--error": "ListScreen.css",
  notice__body: "ListScreen.css",
  notice__detail: "ListScreen.css",
  notice__retry: "ListScreen.css",
  notice__title: "ListScreen.css",
  card: "DetailScreen.css",
  card__head: "DetailScreen.css",
  card__label: "DetailScreen.css",
  sk: "DetailScreen.css",
  toggle: "DetailScreen.css",
  toggle__option: "DetailScreen.css",
};

/** Every class this file writes a rule for. */
function classesIn(file: string): Set<string> {
  const css = fs.readFileSync(path.join(UI, file), "utf8")
    // Strip comments so a class named in prose is not counted.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  for (const m of css.matchAll(/\.([a-zA-Z_][\w-]*)/g)) found.add(m[1]);
  return found;
}

const files = fs.readdirSync(UI).filter((f) => f.endsWith(".css") && f !== "tokens.css");

describe("stylesheet class ownership", () => {
  it("has stylesheets to check", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("no class is defined in two stylesheets unless it is a declared shared primitive", () => {
    const owners = new Map<string, string[]>();
    for (const file of files) {
      for (const cls of classesIn(file)) {
        owners.set(cls, [...(owners.get(cls) ?? []), file]);
      }
    }

    const clashes = [...owners.entries()]
      .filter(([cls, where]) => where.length > 1 && SHARED[cls] === undefined)
      .map(([cls, where]) => `.${cls} in ${where.join(" and ")}`);

    // The message has to name the class, because "a class collides" is
    // useless at 5am and the whole point is that the symptom appears
    // somewhere other than the file that caused it.
    expect(clashes, `these classes are defined in more than one stylesheet, so the last one loaded silently wins:\n  ${clashes.join("\n  ")}`)
      .toEqual([]);
  });

  it("every declared shared class really is defined in the file that owns it", () => {
    // Keeps the allowlist honest: an entry left behind after a rename
    // would otherwise go on excusing a future collision.
    const stale = Object.entries(SHARED)
      .filter(([cls, owner]) => !classesIn(owner).has(cls))
      .map(([cls, owner]) => `.${cls} is listed as owned by ${owner}, which no longer defines it`);
    expect(stale).toEqual([]);
  });
});
