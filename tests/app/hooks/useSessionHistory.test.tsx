// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../../src/storage/repositories/setRepository.js";
import { useSessionHistory } from "../../../src/app/hooks/useSessionHistory.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

const BENCH = "barbell-bench-press";

async function loggedSession(db: GymDatabase, startedAt: number) {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const sets = createSetRepository(db);
  const session = await sessions.create({ startedAt });
  const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
  await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: startedAt });
  await sessions.finish(session.id, startedAt + 100);
  return session;
}

describe("useSessionHistory", () => {
  it("is empty on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useSessionHistory(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    db.close();
  });

  it("lists sessions newest first, with each one's own xp", async () => {
    const db = new GymDatabase(uniqueDbName());
    const older = await loggedSession(db, 0);
    const newer = await loggedSession(db, 10_000);

    const { result } = renderHook(() => useSessionHistory(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries.map((e) => e.session.id)).toEqual([newer.id, older.id]);
    expect(result.current.entries[0]!.xp?.total).toBeGreaterThan(0);
    db.close();
  });

  it("has no xp entry for a session with no completed sets", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: 0 });

    const { result } = renderHook(() => useSessionHistory(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]!.xp).toBeNull();
    db.close();
  });

  it("paginates via loadMore without re-fetching every session's xp", async () => {
    const db = new GymDatabase(uniqueDbName());
    for (let i = 0; i < 25; i++) {
      await loggedSession(db, i * 1000);
    }

    const { result } = renderHook(() => useSessionHistory(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.entries).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
    // Newest-first: the very first entry should be the last one created.
    expect(result.current.entries[0]!.session.startedAt).toBe(24 * 1000);
    expect(result.current.entries[24]!.session.startedAt).toBe(0);
    db.close();
  });
});
