// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../../../src/app/ui/Button.js";

describe("Button", () => {
  it("renders its children and responds to clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Log set</Button>);

    const button = screen.getByRole("button", { name: "Log set" });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Log set
      </Button>
    );

    await userEvent.click(screen.getByRole("button", { name: "Log set" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards a ref to the underlying button element", () => {
    let node: HTMLButtonElement | null = null;
    render(
      <Button
        ref={(el) => {
          node = el;
        }}
      >
        Save
      </Button>
    );
    expect(node).toBeInstanceOf(HTMLButtonElement);
  });
});
