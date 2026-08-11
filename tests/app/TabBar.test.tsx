// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TabBar } from "../../src/app/TabBar.js";

describe("TabBar", () => {
  it("renders all five primary tabs as links to their routes", () => {
    render(
      <MemoryRouter initialEntries={["/today"]}>
        <TabBar />
      </MemoryRouter>
    );

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const expected: Array<[string, string]> = [
      ["Today", "/today"],
      ["History", "/history"],
      ["Start", "/start"],
      ["Progress", "/progress"],
      ["More", "/more"],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks only the current route's tab as active via aria-current", () => {
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <TabBar />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
});
