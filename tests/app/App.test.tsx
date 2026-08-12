// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GymDatabase } from "../../src/storage/db.js";
import { createDeviceSettingsRepository } from "../../src/storage/repositories/deviceSettingsRepository.js";
import { App } from "../../src/app/App.js";
import { ToastProvider } from "../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "./testDb.js";

// Every scenario here is post-onboarding except the dedicated onboarding
// test below — App itself is covered by useOnboarding.test.tsx and
// OnboardingFlow.test.tsx for the pre-onboarding path. Wrapped in
// ToastProvider to match main.tsx's real composition — App.tsx itself
// deliberately doesn't include it (see App.tsx's own comment on staying
// router/provider-light for testability), but several routed screens
// (e.g. /more, /session) call useToast() and would crash without it.
async function renderOnboardedApp(path: string) {
  const db = new GymDatabase(uniqueDbName());
  await createDeviceSettingsRepository(db).update({ onboardingCompleted: true });
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
  return db;
}

describe("App", () => {
  it("redirects the root path to /today", async () => {
    const db = await renderOnboardedApp("/");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument());
    db.close();
  });

  it("renders the matching screen for each tab route", async () => {
    const routes: Array<[string, string]> = [
      ["/history", "History"],
      ["/start", "Start"],
      ["/progress", "Progress"],
      ["/more", "More"],
    ];
    for (const [path, heading] of routes) {
      const db = await renderOnboardedApp(path);
      await waitFor(() => expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument());
      db.close();
    }
  });

  it("falls back to /today for an unknown path", async () => {
    const db = await renderOnboardedApp("/nonexistent");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument());
    db.close();
  });

  it("keeps the tab bar visible alongside the routed content", async () => {
    const db = await renderOnboardedApp("/today");
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument());
    db.close();
  });

  it("shows onboarding instead of the tab shell on a fresh device", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(
      <MemoryRouter initialEntries={["/today"]}>
        <App />
      </MemoryRouter>,
      { wrapper: withDatabase(db) }
    );

    await waitFor(() => expect(screen.getByText(/units do you train in/i)).toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    db.close();
  });
});
