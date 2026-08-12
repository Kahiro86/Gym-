// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { emptyBodyweightHistory } from "../../../src/domain/types.js";
import { MUSCLE_IDS } from "../../../src/domain/muscles.js";
import { SessionSummaryScreen } from "../../../src/app/routes/SessionSummaryScreen.js";
import { uniqueDbName, withDatabase } from "../testDb.js";
import type { SessionSummaryState } from "../../../src/app/session/sessionSummary.js";
import type { SessionXpResult, Pr } from "../../../src/domain/types.js";
import type { MuscleId } from "../../../src/domain/muscles.js";

const BENCH = "barbell-bench-press";

function emptyMuscleXp(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) record[muscle] = 0;
  return record;
}

function fakeXp(overrides: Partial<SessionXpResult> = {}): SessionXpResult {
  return {
    total: 42,
    setBreakdowns: [],
    muscleXp: emptyMuscleXp(),
    prs: [],
    sessionBonusComponents: [],
    updatedExerciseHistory: {},
    updatedBodyweightHistory: emptyBodyweightHistory(),
    ...overrides,
  };
}

function renderAt(db: GymDatabase, state: SessionSummaryState | undefined) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/session/summary", state }]}>
      <Routes>
        <Route path="/session/summary" element={<SessionSummaryScreen />} />
        <Route path="/today" element={<div>TODAY SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("SessionSummaryScreen", () => {
  it("redirects to /today when there is no summary state (e.g. a direct link or refresh)", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderAt(db, undefined);
    expect(await screen.findByText("TODAY SCREEN")).toBeInTheDocument();
    db.close();
  });

  it("shows the total xp earned, without a level-up banner when the level didn't change", async () => {
    const db = new GymDatabase(uniqueDbName());
    const state: SessionSummaryState = {
      xp: fakeXp({ total: 37.4 }),
      levelBefore: { level: 3, xpIntoLevel: 10, xpForNext: 132 },
      levelAfter: { level: 3, xpIntoLevel: 47.4, xpForNext: 132 },
    };
    renderAt(db, state);

    expect(await screen.findByText("37 XP")).toBeInTheDocument();
    expect(screen.queryByText("Level up!")).not.toBeInTheDocument();
    db.close();
  });

  it("shows a level-up banner when the session crossed a level threshold", async () => {
    const db = new GymDatabase(uniqueDbName());
    const state: SessionSummaryState = {
      xp: fakeXp({ total: 500 }),
      levelBefore: { level: 3, xpIntoLevel: 120, xpForNext: 132 },
      levelAfter: { level: 4, xpIntoLevel: 20, xpForNext: 152 },
    };
    renderAt(db, state);

    expect(await screen.findByText("Level up!")).toBeInTheDocument();
    expect(screen.getByText("Lv 3 → Lv 4")).toBeInTheDocument();
    db.close();
  });

  it("lists PRs by exercise name and shows the muscles trained", async () => {
    const db = new GymDatabase(uniqueDbName());
    const muscleXp = emptyMuscleXp();
    muscleXp.chestSternal = 18;
    muscleXp.tricepsLong = 6;

    const prs: Pr[] = [{ type: "weight", exerciseId: BENCH, value: 100, previousBest: 90 }];
    const state: SessionSummaryState = {
      xp: fakeXp({ total: 24, muscleXp, prs }),
      levelBefore: { level: 1, xpIntoLevel: 0, xpForNext: 100 },
      levelAfter: { level: 1, xpIntoLevel: 24, xpForNext: 100 },
    };
    renderAt(db, state);

    expect(await screen.findByText("Barbell Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Weight PR")).toBeInTheDocument();
    expect(screen.getByText("90 → 100")).toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("18 XP")).toBeInTheDocument();
    db.close();
  });

  it("navigates to /today when Done is pressed", async () => {
    const db = new GymDatabase(uniqueDbName());
    const state: SessionSummaryState = {
      xp: fakeXp(),
      levelBefore: { level: 1, xpIntoLevel: 0, xpForNext: 100 },
      levelAfter: { level: 1, xpIntoLevel: 42, xpForNext: 100 },
    };
    renderAt(db, state);

    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByText("TODAY SCREEN")).toBeInTheDocument();
    db.close();
  });
});
