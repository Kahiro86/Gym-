// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadarChart } from "../../../../src/app/progress/heatmap/RadarChart.js";

const AXES = [
  { id: "chest", label: "Chest", value: 0.8, trained: true },
  { id: "back", label: "Back", value: 0, trained: false },
  { id: "shoulders", label: "Shoulders", value: 0.4, trained: true },
  { id: "arms", label: "Arms", value: 0, trained: false },
  { id: "core", label: "Core", value: 0, trained: false },
  { id: "legs", label: "Legs", value: 0, trained: false },
];

describe("RadarChart", () => {
  it("renders one tappable point per axis, labeled with its freshness", () => {
    render(<RadarChart axes={AXES} selectedId={null} onSelect={() => {}} />);

    expect(screen.getByRole("img", { name: "Muscle group freshness radar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chest: 80% fresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back: not trained yet" })).toBeInTheDocument();
  });

  it("calls onSelect when a point is clicked", async () => {
    const onSelect = vi.fn();
    render(<RadarChart axes={AXES} selectedId={null} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: "Chest: 80% fresh" }));
    expect(onSelect).toHaveBeenCalledWith("chest");
  });

  it("calls onSelect on Enter/Space for keyboard users, and marks the selected point aria-pressed", async () => {
    const onSelect = vi.fn();
    render(<RadarChart axes={AXES} selectedId="shoulders" onSelect={onSelect} />);

    const shoulders = screen.getByRole("button", { name: "Shoulders: 40% fresh" });
    expect(shoulders).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Chest: 80% fresh" })).toHaveAttribute("aria-pressed", "false");

    shoulders.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("shoulders");
  });
});
