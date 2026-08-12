// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "../../../src/app/ui/Toggle.js";

describe("Toggle", () => {
  it("renders its label and reflects the checked state", () => {
    render(<Toggle checked label="Reduce motion" onChange={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "Reduce motion" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the flipped value when tapped", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} label="Reduce motion" onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
