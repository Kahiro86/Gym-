// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlateLoader } from "../../../src/app/ui/PlateLoader.js";

describe("PlateLoader", () => {
  it("renders an accessible image with a default label", () => {
    render(<PlateLoader />);
    const svg = screen.getByRole("img", { name: "Loading" });
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("sizes the svg from the size prop", () => {
    render(<PlateLoader size={80} />);
    const svg = screen.getByRole("img", { name: "Loading" });
    expect(svg).toHaveAttribute("width", "80");
    expect(svg).toHaveAttribute("height", "80");
  });

  it("accepts a custom label", () => {
    render(<PlateLoader label="Opening GymXP" />);
    expect(screen.getByRole("img", { name: "Opening GymXP" })).toBeInTheDocument();
  });
});
