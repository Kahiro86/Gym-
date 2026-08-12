// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { createRoutineRepository } from "../../../src/storage/repositories/routineRepository.js";
import { StartSheet } from "../../../src/app/start/StartSheet.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("StartSheet", () => {
  it("renders nothing when closed", () => {
    const db = new GymDatabase(uniqueDbName());
    render(
      <ToastProvider>
        <StartSheet open={false} onClose={() => {}} onStarted={() => {}} />
      </ToastProvider>,
      { wrapper: withDatabase(db) }
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    db.close();
  });

  it("shows an empty state when there are no saved routines", async () => {
    const db = new GymDatabase(uniqueDbName());
    render(
      <ToastProvider>
        <StartSheet open onClose={() => {}} onStarted={() => {}} />
      </ToastProvider>,
      { wrapper: withDatabase(db) }
    );
    await waitFor(() => expect(screen.getByText("No routines yet")).toBeInTheDocument());
    db.close();
  });

  it("Free Workout starts an untagged session and calls onStarted", async () => {
    const db = new GymDatabase(uniqueDbName());
    const onStarted = vi.fn();
    render(
      <ToastProvider>
        <StartSheet open onClose={() => {}} onStarted={onStarted} />
      </ToastProvider>,
      { wrapper: withDatabase(db) }
    );

    await userEvent.click(screen.getByRole("button", { name: "Free Workout" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));

    const active = (await db.sessions.where("state").equals("in_progress").toArray())[0];
    expect(active?.routineId).toBeNull();
    db.close();
  });

  it("lists saved routines and starting one tags the session with its routineId", async () => {
    const db = new GymDatabase(uniqueDbName());
    const routine = await createRoutineRepository(db).create({ name: "Push Day" });
    const onStarted = vi.fn();
    render(
      <ToastProvider>
        <StartSheet open onClose={() => {}} onStarted={onStarted} />
      </ToastProvider>,
      { wrapper: withDatabase(db) }
    );

    const routineRow = await screen.findByRole("button", { name: "Push Day" });
    await userEvent.click(routineRow);
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));

    const active = (await db.sessions.where("state").equals("in_progress").toArray())[0];
    expect(active?.routineId).toBe(routine.id);
    db.close();
  });
});
