// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MuscleGroupSection } from "../../../src/app/progress/MuscleGroupSection.js";
import { MUSCLE_IDS } from "../../../src/domain/muscles.js";
import type { MuscleId } from "../../../src/domain/muscles.js";

function emptyMuscleXp(): Record<MuscleId, number> {
  const record = {} as Record<MuscleId, number>;
  for (const muscle of MUSCLE_IDS) record[muscle] = 0;
  return record;
}

describe("MuscleGroupSection", () => {
  it("lists every muscle in the group with its xp and rank", () => {
    const muscleXp = emptyMuscleXp();
    muscleXp.chestSternal = 42;

    render(<MuscleGroupSection group={{ id: "chest", displayName: "Chest" }} muscleXp={muscleXp} />);

    expect(screen.getByRole("heading", { name: "Chest" })).toBeInTheDocument();
    expect(screen.getByText("Upper Chest")).toBeInTheDocument();
    expect(screen.getByText("42 XP")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument(); // chestSternal's rank at 42 xp
    expect(screen.getByText("—")).toBeInTheDocument(); // chestClavicular, untrained
  });
});
