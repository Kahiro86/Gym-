// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Stepper } from "../../../src/app/ui/Stepper.js";

describe("Stepper", () => {
  it("displays the current value and steps up/down by `step` on tap", async () => {
    const onChange = vi.fn();
    render(<Stepper value={60} step={2.5} onChange={onChange} label="Weight" />);

    expect(screen.getByText("60")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Increase Weight" }));
    expect(onChange).toHaveBeenCalledWith(62.5);

    await userEvent.click(screen.getByRole("button", { name: "Decrease Weight" }));
    expect(onChange).toHaveBeenCalledWith(57.5);
  });

  it("clamps at min/max and disables the corresponding button", async () => {
    const onChange = vi.fn();
    render(<Stepper value={0} min={0} max={10} onChange={onChange} label="Reps" />);

    const decrease = screen.getByRole("button", { name: "Decrease Reps" });
    expect(decrease).toBeDisabled();
    await userEvent.click(decrease);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats the displayed value with formatValue", () => {
    render(<Stepper value={60} onChange={() => {}} formatValue={(v) => `${v} kg`} label="Weight" />);
    expect(screen.getByText("60 kg")).toBeInTheDocument();
  });

  it("repeats the step on a held-down button after the hold delay", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<Stepper value={0} onChange={onChange} label="Reps" />);
      const increase = screen.getByRole("button", { name: "Increase Reps" });

      fireEvent.mouseDown(increase);
      expect(onChange).not.toHaveBeenCalled(); // mousedown alone doesn't apply

      vi.advanceTimersByTime(400); // hold-repeat delay
      vi.advanceTimersByTime(90 * 3); // three repeat intervals
      fireEvent.mouseUp(increase);

      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is inert while disabled", async () => {
    const onChange = vi.fn();
    render(<Stepper value={5} onChange={onChange} disabled label="Reps" />);
    expect(screen.getByRole("button", { name: "Increase Reps" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease Reps" })).toBeDisabled();
  });
});
