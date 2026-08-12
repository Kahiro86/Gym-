// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RankBadge } from "../../../src/app/progress/RankBadge.js";

describe("RankBadge", () => {
  it("renders a dash for unranked", () => {
    render(<RankBadge rank="unranked" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the rank letter for a real rank", () => {
    render(<RankBadge rank="S" />);
    expect(screen.getByText("S")).toBeInTheDocument();
  });
});
