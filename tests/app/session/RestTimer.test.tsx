// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createDeviceSettingsRepository } from "../../../src/storage/repositories/deviceSettingsRepository.js";
import { useActiveSessionStore } from "../../../src/app/store/activeSessionStore.js";
import { RestTimer } from "../../../src/app/session/RestTimer.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

function resetStore(): void {
  useActiveSessionStore.setState({ restStartedAt: null, restDurationSec: 0 });
}

describe("RestTimer", () => {
  afterEach(() => {
    resetStore();
  });

  it("renders nothing when no rest is running", () => {
    const db = new GymDatabase(uniqueDbName());
    render(<RestTimer />, { wrapper: withDatabase(db) });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    db.close();
  });

  it("shows a formatted mm:ss countdown while resting", () => {
    const db = new GymDatabase(uniqueDbName());
    useActiveSessionStore.getState().startRest(90);

    render(<RestTimer />, { wrapper: withDatabase(db) });
    expect(screen.getByText("1:30")).toBeInTheDocument();
    db.close();
  });

  it("+15s extends the duration without resetting the elapsed time", () => {
    const db = new GymDatabase(uniqueDbName());
    useActiveSessionStore.getState().startRest(60);

    render(<RestTimer />, { wrapper: withDatabase(db) });
    expect(screen.getByText("1:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+15s" }));
    expect(screen.getByText("1:15")).toBeInTheDocument();
    db.close();
  });

  it("Skip stops the timer immediately", () => {
    const db = new GymDatabase(uniqueDbName());
    useActiveSessionStore.getState().startRest(60);

    render(<RestTimer />, { wrapper: withDatabase(db) });
    expect(screen.getByText("1:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(useActiveSessionStore.getState().restStartedAt).toBeNull();
    db.close();
  });

  it("fires a haptic pulse once when the countdown reaches zero, unless reduceMotion is on", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createDeviceSettingsRepository(db).update({ reduceMotion: false });
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    // Already elapsed — remaining is 0 from the very first render, no
    // need to wait out a real countdown. Exercises the race between this
    // and deviceSettings still loading (see the guard in RestTimer.tsx).
    useActiveSessionStore.setState({ restStartedAt: Date.now() - 5000, restDurationSec: 1 });

    render(<RestTimer />, { wrapper: withDatabase(db) });
    expect(screen.getByText("0:00")).toBeInTheDocument();
    await waitFor(() => expect(vibrate).toHaveBeenCalledTimes(1));
    db.close();
  });

  it("does not fire a haptic when reduceMotion is on", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createDeviceSettingsRepository(db).update({ reduceMotion: true });
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    useActiveSessionStore.setState({ restStartedAt: Date.now() - 5000, restDurationSec: 1 });

    render(<RestTimer />, { wrapper: withDatabase(db) });
    expect(screen.getByText("0:00")).toBeInTheDocument();

    // Give the loading deviceSettings a real chance to resolve, then
    // confirm the haptic never fired.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(vibrate).not.toHaveBeenCalled();
    db.close();
  });
});
