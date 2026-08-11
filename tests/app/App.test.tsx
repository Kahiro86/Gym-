// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../../src/app/App.js";

describe("App", () => {
  it("redirects the root path to /today", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("renders the matching screen for each tab route", () => {
    const routes: Array<[string, string]> = [
      ["/history", "History"],
      ["/start", "Start"],
      ["/progress", "Progress"],
      ["/more", "More"],
    ];
    for (const [path, heading] of routes) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to /today for an unknown path", () => {
    render(
      <MemoryRouter initialEntries={["/nonexistent"]}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("keeps the tab bar visible alongside the routed content", () => {
    render(
      <MemoryRouter initialEntries={["/today"]}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});
