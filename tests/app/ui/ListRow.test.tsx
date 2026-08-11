// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListRow } from "../../../src/app/ui/ListRow.js";

describe("ListRow", () => {
  it("renders as a button and fires onClick when interactive", async () => {
    const onClick = vi.fn();
    render(<ListRow label="Bench Press" description="3x8 @ 60kg" trailing="+120 XP" onClick={onClick} />);

    const row = screen.getByRole("button", { name: /Bench Press/ });
    expect(screen.getByText("3x8 @ 60kg")).toBeInTheDocument();
    expect(screen.getByText("+120 XP")).toBeInTheDocument();

    await userEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders as a non-interactive row with no button semantics when onClick is omitted", () => {
    render(<ListRow label="Bench Press" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });
});
