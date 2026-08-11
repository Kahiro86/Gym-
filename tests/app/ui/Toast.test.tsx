// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { useToast } from "../../../src/app/ui/ToastContext.js";

function TriggerButton({ withAction, onAction }: { withAction?: boolean; onAction?: () => void }) {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        showToast({
          message: "Set deleted",
          action: withAction ? { label: "Undo", onAction: onAction ?? (() => {}) } : undefined,
        })
      }
    >
      Delete set
    </button>
  );
}

describe("ToastProvider / useToast", () => {
  it("shows nothing until showToast is called", () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the toast message after showToast, and Dismiss removes it", async () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete set" }));
    expect(screen.getByRole("status")).toHaveTextContent("Set deleted");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("runs the action and dismisses when the action button is clicked", async () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <TriggerButton withAction onAction={onAction} />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete set" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-dismisses after its default duration elapses", () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <TriggerButton />
        </ToastProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Delete set" }));
      expect(screen.getByRole("status")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces a still-showing toast rather than stacking", () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <TriggerButton />
        </ToastProvider>
      );
      const button = screen.getByRole("button", { name: "Delete set" });
      fireEvent.click(button);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      fireEvent.click(button); // resets the timer

      act(() => {
        vi.advanceTimersByTime(4000); // 8s total, but only 4s since the reset
      });
      expect(screen.getByRole("status")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000); // 5s since the reset
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
