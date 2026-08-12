import { describe, it, expect } from "vitest";

// WCAG 2.1 relative luminance / contrast ratio (spec §14 task 19) —
// verifies the token pairs the app actually pairs text against, so a
// future palette tweak that regresses contrast fails a test instead of
// shipping quietly. Hex values are duplicated from tokens.css rather than
// parsed from it, since this only needs to catch drift in the numbers,
// not track the file.
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const light = Math.max(luminanceA, luminanceB);
  const dark = Math.min(luminanceA, luminanceB);
  return (light + 0.05) / (dark + 0.05);
}

const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_TEXT = 3;

const TOKENS = {
  surface: "1f1d1b",
  surfaceRaised: "2a2724",
  chalk: "f2efe9",
  chalkDim: "9a948b",
  plateRed: "d4342a",
  plateRedBg: "aa2a22",
  plateRedLight: "df675f",
  plateBlue: "1e6fbf",
  plateBlueBg: "1a5ea2",
  plateBlueLight: "5693cf",
  plateYellow: "e8b317",
  plateGreen: "2e8b4f",
  plateGreenBg: "1c532f",
};

describe("contrastRatio", () => {
  it("matches a known reference pair (black on white is exactly 21:1)", () => {
    expect(contrastRatio("000000", "ffffff")).toBeCloseTo(21, 5);
  });
});

describe("palette contrast (spec §14 task 19)", () => {
  it("body and secondary text on both surfaces clear AA normal-text", () => {
    expect(contrastRatio(TOKENS.chalk, TOKENS.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TOKENS.chalkDim, TOKENS.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TOKENS.chalkDim, TOKENS.surfaceRaised)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("XP figures (plate-yellow text) on both surfaces clear AA normal-text", () => {
    expect(contrastRatio(TOKENS.plateYellow, TOKENS.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TOKENS.plateYellow, TOKENS.surfaceRaised)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("chalk on the -bg badge/banner variants clears AA normal-text (Button.primary, RankBadge, PR badges, DegradedBanner, the level-up banner)", () => {
    expect(contrastRatio(TOKENS.chalk, TOKENS.plateRedBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TOKENS.chalk, TOKENS.plateBlueBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TOKENS.chalk, TOKENS.plateGreenBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("the -light foreground variants clear AA normal-text against both surfaces (Toast's action label, Button.danger)", () => {
    expect(contrastRatio(TOKENS.plateBlueLight, TOKENS.surfaceRaised)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TOKENS.plateRedLight, TOKENS.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("base plate-red as large/bold text (StreakCard's 28px value) still clears AA large-text on its own", () => {
    expect(contrastRatio(TOKENS.plateRed, TOKENS.surface)).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
  });
});
