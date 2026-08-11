// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../../../src/app/ui/EmptyState.js";

describe("EmptyState", () => {
  it("renders the title always, and description/action only when provided", () => {
    const { rerender } = render(<EmptyState title="No sessions yet" />);
    expect(screen.getByRole("heading", { name: "No sessions yet" })).toBeInTheDocument();
    expect(screen.queryByText(/Start your first/)).not.toBeInTheDocument();

    rerender(
      <EmptyState
        title="No sessions yet"
        description="Start your first workout to see it here."
        action={<button type="button">Start workout</button>}
      />
    );
    expect(screen.getByText("Start your first workout to see it here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start workout" })).toBeInTheDocument();
  });
});
