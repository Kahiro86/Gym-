// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingScreen } from "../../../src/app/ui/LoadingScreen.js";

describe("LoadingScreen", () => {
  it("renders a centered PlateLoader", () => {
    render(<LoadingScreen label="Opening GymXP" />);
    expect(screen.getByRole("img", { name: "Opening GymXP" })).toBeInTheDocument();
  });
});
