// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createBodyweightRepository } from "../../../src/storage/repositories/bodyweightRepository.js";
import { LogSetForm } from "../../../src/app/session/LogSetForm.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

async function seedSessionExercise(db: GymDatabase, exerciseId: string) {
  const session = await createSessionRepository(db).create({ startedAt: Date.now() });
  return createSessionExerciseRepository(db).add({ sessionId: session.id, exerciseId });
}

describe("LogSetForm", () => {
  it("shows Weight and Reps steppers for a weight+reps exercise and logs a set with the stamped bodyweight", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createBodyweightRepository(db).log({ bodyweightKg: 82, recordedAt: Date.now() - 1000 });
    const se = await seedSessionExercise(db, "barbell-bench-press");
    const onLogged = vi.fn();

    render(<LogSetForm sessionExerciseId={se.id} exerciseId="barbell-bench-press" onLogged={onLogged} />, {
      wrapper: withDatabase(db),
    });

    await waitFor(() => expect(screen.getByRole("group", { name: "Weight" })).toBeInTheDocument());
    expect(screen.getByRole("group", { name: "Reps" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1));

    const sets = await db.sets.where("sessionExerciseId").equals(se.id).toArray();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.weightKg).toBe(20); // default
    expect(sets[0]?.reps).toBe(8); // default
    expect(sets[0]?.bodyweightKgAtTime).toBe(82);
    expect(sets[0]?.isWarmup).toBe(false);
    db.close();
  });

  it("shows only a Reps stepper for a pure bodyweight exercise, with no weight logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db, "pushup");
    render(<LogSetForm sessionExerciseId={se.id} exerciseId="pushup" />, { wrapper: withDatabase(db) });

    await waitFor(() => expect(screen.getByRole("group", { name: "Reps" })).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Weight" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Log set" })).toBeEnabled()); // saving settled

    const [set] = await db.sets.where("sessionExerciseId").equals(se.id).toArray();
    expect(set?.weightKg).toBeNull();
    expect(set?.reps).toBe(8);
    db.close();
  });

  it("toggling Warmup logs the next set as a warmup, then resets back to off", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db, "barbell-bench-press");
    render(<LogSetForm sessionExerciseId={se.id} exerciseId="barbell-bench-press" />, { wrapper: withDatabase(db) });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Warmup set" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("checkbox", { name: "Warmup set" }));
    await userEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(async () => expect(await db.sets.where("sessionExerciseId").equals(se.id).count()).toBe(1));
    const [set] = await db.sets.where("sessionExerciseId").equals(se.id).toArray();
    expect(set?.isWarmup).toBe(true);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Warmup set" })).not.toBeChecked());
    db.close();
  });

  it("editing the weight via the numeric field changes what gets logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db, "barbell-bench-press");
    render(<LogSetForm sessionExerciseId={se.id} exerciseId="barbell-bench-press" />, { wrapper: withDatabase(db) });

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Weight" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Edit Weight" }));
    const input = screen.getByRole("textbox", { name: "Weight" });
    await userEvent.clear(input);
    await userEvent.type(input, "102.5");
    await userEvent.tab();

    await userEvent.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Log set" })).toBeEnabled()); // saving settled
    const [set] = await db.sets.where("sessionExerciseId").equals(se.id).toArray();
    expect(set?.weightKg).toBe(102.5);
    db.close();
  });
});
