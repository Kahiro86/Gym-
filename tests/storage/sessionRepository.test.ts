import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSessionRepository, bumpSessionActivity } from "../../src/storage/repositories/sessionRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

async function addSessionExercise(db: GymDatabase, id: string, sessionId: string) {
  const deviceId = await db.getDeviceId();
  await db.sessionExercises.add({
    id,
    sessionId,
    exerciseId: BENCH,
    orderIndex: 1000,
    supersetGroup: null,
    note: null,
    substitutedFromId: null,
    plannedFromRoutineExerciseId: null,
    updatedAt: Date.now(),
    deletedAt: null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
}

async function addSet(db: GymDatabase, id: string, sessionExerciseId: string, overrides: Partial<{ completed: boolean; deletedAt: number | null }> = {}) {
  const deviceId = await db.getDeviceId();
  await db.sets.add({
    id,
    sessionExerciseId,
    exerciseId: BENCH,
    orderIndex: 1000,
    weightKg: 60,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    completed: overrides.completed ?? true,
    targetReps: null,
    note: null,
    bodyweightKgAtTime: 80,
    loggedAt: Date.now(),
    restBeforeSec: null,
    updatedAt: Date.now(),
    deletedAt: overrides.deletedAt ?? null,
    deviceId,
    syncedAt: null,
    serverUpdatedAt: null,
  });
}

describe("SessionRepository", () => {
  it("create() writes an in_progress session, capturing tzOffsetMinutes", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const session = await repo.create({ startedAt: 1000 });
    expect(session.state).toBe("in_progress");
    expect(session.endedAt).toBeNull();
    expect(session.tzOffsetMinutes).toBe(new Date(1000).getTimezoneOffset());
    expect(session.lastActivityAt).toBe(1000);
    db.close();
  });

  it("create() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    await repo.create({ startedAt: 1000 });
    const queued = await db.syncQueue.where("entityType").equals("session").toArray();
    expect(queued.length).toBe(1);
    db.close();
  });

  it("getById returns null for a nonexistent or deleted session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    expect(await repo.getById("nope")).toBeNull();

    const session = await repo.create({ startedAt: 1000 });
    await addSessionExercise(db, "se1", session.id);
    await addSet(db, "set1", "se1");
    await repo.finish(session.id, 2000);
    await repo.softDelete(session.id);
    expect(await repo.getById(session.id)).toBeNull();
    db.close();
  });

  it("getActive returns the in_progress session, null once finished", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const session = await repo.create({ startedAt: 1000 });
    expect((await repo.getActive())?.id).toBe(session.id);

    await addSessionExercise(db, "se1", session.id);
    await addSet(db, "set1", "se1");
    await repo.finish(session.id, 2000);
    expect(await repo.getActive()).toBeNull();
    db.close();
  });

  it("enforces a single in_progress session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    await repo.create({ startedAt: 1000 });
    await expect(repo.create({ startedAt: 2000 })).rejects.toThrow(/in_progress/);
    db.close();
  });

  describe("finish()", () => {
    it("marks a session completed when it has at least one completed set", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await addSessionExercise(db, "se1", session.id);
      await addSet(db, "set1", "se1", { completed: true });

      await repo.finish(session.id, 2000);
      const finished = await repo.getById(session.id);
      expect(finished?.state).toBe("completed");
      expect(finished?.endedAt).toBe(2000);
      db.close();
    });

    it("discards a session with zero completed sets — a failed-attempt-only session never becomes history", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await addSessionExercise(db, "se1", session.id);
      await addSet(db, "set1", "se1", { completed: false });

      await repo.finish(session.id, 2000);
      const finished = await repo.getById(session.id);
      expect(finished?.state).toBe("discarded");
      db.close();
    });

    it("discards a session with no sets logged at all", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await repo.finish(session.id, 2000);
      expect((await repo.getById(session.id))?.state).toBe("discarded");
      db.close();
    });

    it("ignores soft-deleted completed sets when deciding completed vs discarded", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await addSessionExercise(db, "se1", session.id);
      await addSet(db, "set1", "se1", { completed: true, deletedAt: Date.now() });

      await repo.finish(session.id, 2000);
      expect((await repo.getById(session.id))?.state).toBe("discarded");
      db.close();
    });

    it("allows a new session once the previous one is finished", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const first = await repo.create({ startedAt: 1000 });
      await repo.finish(first.id, 1500);
      await expect(repo.create({ startedAt: 2000 })).resolves.toBeDefined();
      db.close();
    });
  });

  describe("discard() / markAbandoned() / resume()", () => {
    it("discard() transitions state and allows a new session", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await repo.discard(session.id);
      expect((await repo.getById(session.id))?.state).toBe("discarded");
      await expect(repo.create({ startedAt: 2000 })).resolves.toBeDefined();
      db.close();
    });

    it("markAbandoned() transitions state and allows a new session", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await repo.markAbandoned(session.id);
      expect((await repo.getById(session.id))?.state).toBe("abandoned");
      await expect(repo.create({ startedAt: 2000 })).resolves.toBeDefined();
      db.close();
    });

    it("resume() transitions an abandoned session back to in_progress and bumps lastActivityAt", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await repo.markAbandoned(session.id);

      const before = Date.now();
      const resumed = await repo.resume(session.id);
      expect(resumed.state).toBe("in_progress");
      expect(resumed.lastActivityAt).toBeGreaterThanOrEqual(before);
      expect((await repo.getActive())?.id).toBe(session.id);
      db.close();
    });

    it("resume() refuses to double-activate when another session is already in_progress", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const abandoned = await repo.create({ startedAt: 1000 });
      await repo.markAbandoned(abandoned.id);
      await repo.create({ startedAt: 2000 }); // now in_progress

      await expect(repo.resume(abandoned.id)).rejects.toThrow(/already in_progress/);
      db.close();
    });
  });

  describe("checkForActiveSession()", () => {
    it("returns null when there is no in_progress session", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      expect(await repo.checkForActiveSession()).toBeNull();
      db.close();
    });

    it("returns the session unmarked when activity is recent", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: Date.now() });
      const check = await repo.checkForActiveSession();
      expect(check?.isStale).toBe(false);
      expect(check?.session.id).toBe(session.id);
      expect((await repo.getById(session.id))?.state).toBe("in_progress");
      db.close();
    });

    it("marks a stale in_progress session (>6h since last activity) as abandoned", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
      const session = await repo.create({ startedAt: sevenHoursAgo });

      const check = await repo.checkForActiveSession();
      expect(check?.isStale).toBe(true);
      expect(check?.session.state).toBe("abandoned");
      expect((await repo.getById(session.id))?.state).toBe("abandoned");
      db.close();
    });
  });

  describe("listRecent", () => {
    it("excludes discarded and soft-deleted sessions, ordered newest-first", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);

      const a = await repo.create({ startedAt: 1000 });
      await addSessionExercise(db, "sea", a.id);
      await addSet(db, "seta", "sea");
      await repo.finish(a.id, 1100); // completed

      const b = await repo.create({ startedAt: 2000 });
      await repo.finish(b.id, 2100); // discarded (no sets)

      const c = await repo.create({ startedAt: 3000 });
      await addSessionExercise(db, "sec", c.id);
      await addSet(db, "setc", "sec");
      await repo.finish(c.id, 3100); // completed

      const recent = await repo.listRecent(10);
      expect(recent.map((s) => s.id)).toEqual([c.id, a.id]);
      db.close();
    });

    it("paginates with the `before` cursor", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const a = await repo.create({ startedAt: 1000 });
      await addSessionExercise(db, "sea", a.id);
      await addSet(db, "seta", "sea");
      await repo.finish(a.id, 1100);

      const b = await repo.create({ startedAt: 2000 });
      await addSessionExercise(db, "seb", b.id);
      await addSet(db, "setb", "seb");
      await repo.finish(b.id, 2100);

      const page = await repo.listRecent(10, 2000);
      expect(page.map((s) => s.id)).toEqual([a.id]);
      db.close();
    });
  });

  describe("bumpSessionActivity", () => {
    it("updates only lastActivityAt", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionRepository(db);
      const session = await repo.create({ startedAt: 1000 });
      await bumpSessionActivity(db, session.id, 5000);
      const updated = await repo.getById(session.id);
      expect(updated?.lastActivityAt).toBe(5000);
      db.close();
    });
  });
});
