import { describe, it, expect } from "vitest";
import { MUSCLES, GROUPS, getMuscle, musclesInGroup, musclesInView } from "../src/domain/muscles.js";

describe("muscle registry", () => {
  it("has 24 tier-1 muscles with unique ids (v2 §3.3)", () => {
    expect(MUSCLES.length).toBe(24);
    expect(new Set(MUSCLES.map((m) => m.id)).size).toBe(24);
  });

  it("has 6 tier-2 groups", () => {
    expect(GROUPS.map((g) => g.id).sort()).toEqual(["arms", "back", "chest", "core", "legs", "shoulders"].sort());
  });

  it("every muscle belongs to a real group and has at least one view", () => {
    const groupIds = new Set(GROUPS.map((g) => g.id));
    for (const muscle of MUSCLES) {
      expect(groupIds.has(muscle.groupId), muscle.id).toBe(true);
      expect(muscle.views.length, muscle.id).toBeGreaterThan(0);
      expect(muscle.tauDays, muscle.id).toBeGreaterThan(0);
      expect(muscle.volumeFloor, muscle.id).toBeGreaterThan(0);
    }
  });

  it("initializes every muscle's tau_days identically (v2 §3.3: don't invent per-muscle values up front)", () => {
    expect(new Set(MUSCLES.map((m) => m.tauDays)).size).toBe(1);
  });

  it("splits deltoid, pec, traps, and triceps into heads; splits back into lats/rhomboids; keeps quads/glutes atomic", () => {
    const ids = MUSCLES.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "deltAnterior", "deltLateral", "deltPosterior",
        "chestClavicular", "chestSternal",
        "trapUpper", "trapMid", "trapLower",
        "tricepsLong", "tricepsLateral",
        "lats", "rhomboids",
      ])
    );
    expect(ids).toContain("quads");
    expect(ids).toContain("glutes");
    expect(ids).not.toContain("vastusLateralis");
  });

  it("getMuscle throws on an unknown id", () => {
    // @ts-expect-error intentionally invalid
    expect(() => getMuscle("not-a-muscle")).toThrow();
  });

  it("musclesInGroup and musclesInView filter consistently with the registry", () => {
    const chest = musclesInGroup("chest");
    expect(chest.map((m) => m.id).sort()).toEqual(["chestClavicular", "chestSternal"].sort());

    const front = musclesInView("front");
    expect(front.length).toBeGreaterThan(0);
    for (const m of front) expect(m.views).toContain("front");
  });
});
