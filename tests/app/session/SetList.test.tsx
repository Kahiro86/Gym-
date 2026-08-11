// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { useSets } from "../../../src/app/hooks/useSets.js";
import { SetList } from "../../../src/app/session/SetList.js";
import { ToastProvider } from "../../../src/app/ui/ToastProvider.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

async function seedSessionExercise(db: GymDatabase) {
  const session = await createSessionRepository(db).create({ startedAt: Date.now() });
  return createSessionExerciseRepository(db).add({ sessionId: session.id, exerciseId: BENCH });
}

// SetList takes `sets`/`remove`/`log` as props (the same useSets()
// instance a sibling LogSetForm would write through) — this harness
// mirrors that real usage (see ExerciseCard).
function Harness({ sessionExerciseId }: { sessionExerciseId: string }) {
  const { sets, remove, log } = useSets(sessionExerciseId);
  return <SetList sets={sets} remove={remove} log={log} />;
}

function renderWithToast(db: GymDatabase, sessionExerciseId: string) {
  return render(
    <ToastProvider>
      <Harness sessionExerciseId={sessionExerciseId} />
    </ToastProvider>,
    { wrapper: withDatabase(db) }
  );
}

describe("SetList", () => {
  it("renders nothing when no sets have been logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db);
    const { container } = renderWithToast(db, se.id);
    await waitFor(() => expect(container.querySelector("ul")).not.toBeInTheDocument());
    db.close();
  });

  it("lists logged sets in order with a 1-based index", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db);
    const sets = createSetRepository(db);
    await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await sets.log({ sessionExerciseId: se.id, weightKg: 65, reps: 4, bodyweightKgAtTime: 80, loggedAt: 2000 });

    renderWithToast(db, se.id);
    await waitFor(() => expect(screen.getByText("60 kg × 5")).toBeInTheDocument());
    expect(screen.getByText("65 kg × 4")).toBeInTheDocument();
    db.close();
  });

  it("marks a warmup set", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db);
    await createSetRepository(db).log({ sessionExerciseId: se.id, weightKg: 20, reps: 10, isWarmup: true, bodyweightKgAtTime: 80, loggedAt: 1000 });

    renderWithToast(db, se.id);
    await waitFor(() => expect(screen.getByText("Warmup")).toBeInTheDocument());
    db.close();
  });

  it("deletes a set and shows an undo toast that restores it", async () => {
    const db = new GymDatabase(uniqueDbName());
    const se = await seedSessionExercise(db);
    await createSetRepository(db).log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });

    renderWithToast(db, se.id);
    await waitFor(() => expect(screen.getByText("60 kg × 5")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete set 1" }));
    await waitFor(() => expect(screen.queryByText("60 kg × 5")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Set deleted");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("60 kg × 5")).toBeInTheDocument());

    const remaining = await db.sets.where("sessionExerciseId").equals(se.id).toArray();
    expect(remaining.filter((s) => s.deletedAt === null)).toHaveLength(1);
    db.close();
  });
});
