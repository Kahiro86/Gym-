// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "../../../src/app/ui/Card.js";

describe("Card", () => {
  it("renders its children", () => {
    render(
      <Card>
        <p>Session summary</p>
      </Card>
    );
    expect(screen.getByText("Session summary")).toBeInTheDocument();
  });

  it("merges a caller-supplied className rather than replacing the base class", () => {
    render(
      <Card className="custom" data-testid="card">
        content
      </Card>
    );
    const card = screen.getByTestId("card");
    expect(card.className).toContain("custom");
  });
});
