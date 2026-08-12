// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRegisterSW } from "virtual:pwa-register/react";
import { PwaUpdateBanner } from "../../../src/app/pwa/PwaUpdateBanner.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";

// tests/setup.ts's global vi.mock() stub is what makes "virtual:pwa-register/react"
// resolvable at all in a vitest environment (see vitest.config.ts's own
// comment) — each test here overrides its return value to drive
// PwaUpdateBanner through the states that stub can't exercise on its own.
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: vi.fn() }));

function renderBanner() {
  return render(
    <ToastProvider>
      <PwaUpdateBanner />
    </ToastProvider>
  );
}

describe("PwaUpdateBanner", () => {
  it("renders nothing when there's no update and offline readiness hasn't fired", () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: async () => {},
    });
    renderBanner();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a toast once offline-ready fires", () => {
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [false, () => {}],
      offlineReady: [true, () => {}],
      updateServiceWorker: async () => {},
    });
    renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent("Ready to work offline");
  });

  it("shows a Reload action when a new version is available, and calls updateServiceWorker", async () => {
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useRegisterSW).mockReturnValue({
      needRefresh: [true, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker,
    });
    renderBanner();

    expect(screen.getByRole("status")).toHaveTextContent("A new version is available");
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });
});
