// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSettingsRepository } from "../../../src/storage/repositories/settingsRepository.js";
import { createBodyweightRepository } from "../../../src/storage/repositories/bodyweightRepository.js";
import { OnboardingFlow } from "../../../src/app/onboarding/OnboardingFlow.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("OnboardingFlow", () => {
  it("walks through all three questions and persists the chosen answers on Finish", async () => {
    const db = new GymDatabase(uniqueDbName());
    const onDone = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingFlow onDone={onDone} />, { wrapper: withDatabase(db) });

    // Step 1: units.
    expect(screen.getByText(/units do you train in/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pounds" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 2: bodyweight — bump it up a couple of taps.
    expect(screen.getByText(/current bodyweight/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Increase Bodyweight" }));
    await userEvent.click(screen.getByRole("button", { name: "Increase Bodyweight" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: weekly target.
    expect(screen.getByText(/sessions a week/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Increase Weekly target" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const settings = await createSettingsRepository(db).get();
    expect(settings.units).toBe("lb");
    expect(settings.weeklyTargetSessions).toBe(4); // default 3 + one tap

    const [entry] = await createBodyweightRepository(db).listRecent(1);
    expect(entry?.bodyweightKg).toBe(71); // default 70 + two 0.5 taps
    db.close();
  });

  it("Skip commits immediately without writing a bodyweight entry or a weekly target", async () => {
    const db = new GymDatabase(uniqueDbName());
    const onDone = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingFlow onDone={onDone} />, { wrapper: withDatabase(db) });

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const settings = await createSettingsRepository(db).get();
    expect(settings.weeklyTargetSessions).toBeNull();
    expect(await createBodyweightRepository(db).listRecent(1)).toEqual([]);
    db.close();
  });

  it("Skip from a later step still skips the whole flow rather than just the current question", async () => {
    const db = new GymDatabase(uniqueDbName());
    const onDone = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingFlow onDone={onDone} />, { wrapper: withDatabase(db) });

    await userEvent.click(screen.getByRole("button", { name: "Next" })); // -> bodyweight step
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(await createBodyweightRepository(db).listRecent(1)).toEqual([]);
    db.close();
  });
});
