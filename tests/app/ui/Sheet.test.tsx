// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "../../../src/app/ui/Sheet.js";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} title="Add exercise">
        <p>Body</p>
      </Sheet>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders as a labeled dialog when open", () => {
    render(
      <Sheet open onClose={() => {}} title="Add exercise">
        <p>Body</p>
      </Sheet>
    );
    expect(screen.getByRole("dialog", { name: "Add exercise" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("calls onClose when the backdrop is clicked but not when the sheet body is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Add exercise">
        <button type="button">Inside</button>
      </Sheet>
    );

    await userEvent.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Add exercise">
        <p>Body</p>
      </Sheet>
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open when nothing inside claims it itself", async () => {
    render(
      <Sheet open onClose={() => {}} title="Add exercise">
        <button type="button">Inside</button>
      </Sheet>
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("doesn't steal focus from content that already claims its own (e.g. autoFocus)", async () => {
    render(
      <Sheet open onClose={() => {}} title="Add exercise">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input type="text" aria-label="Name" autoFocus />
      </Sheet>
    );
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
  });

  it("traps Tab within the dialog, wrapping from the last focusable element to the first", async () => {
    render(
      <Sheet open onClose={() => {}} title="Add exercise">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Sheet>
    );
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    last.focus();
    await userEvent.tab();
    expect(first).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it("restores focus to whatever opened it once closed", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Add exercise">
            <p>Body</p>
          </Sheet>
        </>
      );
    }
    render(<Harness />);

    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
