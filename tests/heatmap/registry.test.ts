import { describe, it, expect } from "vitest";
import { HEATMAP_MUSCLES, HEATMAP_GROUPS, getHeatmapMuscle, musclesInGroup, musclesInView } from "../../src/heatmap/registry.js";

describe("heatmap registry", () => {
  it("has 23 tier-1 muscles with unique ids", () => {
    expect(HEATMAP_MUSCLES.length).toBe(23);
    expect(new Set(HEATMAP_MUSCLES.map((m) => m.id)).size).toBe(23);
  });

  it("has 6 tier-2 groups matching the spec", () => {
    expect(HEATMAP_GROUPS.map((g) => g.id).sort()).toEqual(["arms", "back", "chest", "core", "legs", "shoulders"].sort());
  });

  it("every muscle belongs to a real group and has at least one view", () => {
    const groupIds = new Set(HEATMAP_GROUPS.map((g) => g.id));
    for (const muscle of HEATMAP_MUSCLES) {
      expect(groupIds.has(muscle.groupId), muscle.id).toBe(true);
      expect(muscle.views.length, muscle.id).toBeGreaterThan(0);
      expect(muscle.tauDays, muscle.id).toBeGreaterThan(0);
      expect(muscle.volumeFloor, muscle.id).toBeGreaterThan(0);
    }
  });

  it("initializes every muscle's tau_days identically, per §7", () => {
    const distinctTau = new Set(HEATMAP_MUSCLES.map((m) => m.tauDays));
    expect(distinctTau.size).toBe(1);
  });

  it("splits deltoid, pectoralis, and trapezius into heads; keeps quads/glutes atomic", () => {
    const ids = HEATMAP_MUSCLES.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(["deltAnterior", "deltLateral", "deltPosterior", "pecClavicular", "pecSternal", "trapsUpper", "trapsMid", "trapsLower", "tricepsLong", "tricepsLateral"])
    );
    expect(ids).toContain("quads");
    expect(ids).toContain("glutes");
    expect(ids).not.toContain("vastusLateralis");
    expect(ids).not.toContain("gluteusMedius");
  });

  it("both-views muscles (traps/delts/obliques/forearms/calves) render in front and back", () => {
    for (const id of ["trapsUpper", "deltLateral", "obliques", "forearms", "calves"] as const) {
      const muscle = getHeatmapMuscle(id);
      expect(muscle.views, id).toEqual(expect.arrayContaining(["front", "back"]));
    }
  });

  it("musclesInGroup and musclesInView filter consistently with the registry", () => {
    const chest = musclesInGroup("chest");
    expect(chest.map((m) => m.id).sort()).toEqual(["pecClavicular", "pecSternal"].sort());

    const front = musclesInView("front");
    expect(front.length).toBeGreaterThan(0);
    for (const m of front) expect(m.views).toContain("front");
  });
});
