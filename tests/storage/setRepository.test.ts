import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { ValidationError } from "../../src/storage/validation.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";
const SQUAT = "back-squat";

async function setupSession(db: GymDatabase) {
  const sessions = createSessionRepository(db);
  const sessionExercises = createSessionExerciseRepository(db);
  const session = await sessions.create({ startedAt: 1_000_000 });
  const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
  return { session, sessionExercise: se };
}

describe("SetRepository writes", () => {
  it("log() writes a durable set, deriving exerciseId from the sessionExercise", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { sessionExercise } = await setupSession(db);
    const repo = createSetRepository(db);

    const set = await repo.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
    expect(set.exerciseId).toBe(BENCH);
    expect(set.orderIndex).toBe(1000);
    expect(await db.sets.get(set.id)).toBeDefined();
    db.close();
  });

  it("log() defaults isWarmup to false and completed to true", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { sessionExercise } = await setupSession(db);
    const repo = createSetRepository(db);
    const set = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
    expect(set.isWarmup).toBe(false);
    expect(set.completed).toBe(true);
    db.close();
  });

  it("log() honors explicit isWarmup/completed overrides", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { sessionExercise } = await setupSession(db);
    const repo = createSetRepository(db);
    const set = await repo.log({
      sessionExerciseId: sessionExercise.id,
      bodyweightKgAtTime: 80,
      loggedAt: 1_000_000,
      isWarmup: true,
      completed: false,
    });
    expect(set.isWarmup).toBe(true);
    expect(set.completed).toBe(false);
    db.close();
  });

  it("log() rejects out-of-bounds fields and writes nothing", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { sessionExercise } = await setupSession(db);
    const repo = createSetRepository(db);

    await expect(repo.log({ sessionExerciseId: sessionExercise.id, weightKg: 501, bodyweightKgAtTime: 80, loggedAt: 1_000_000 })).rejects.toThrow(
      ValidationError
    );
    await expect(repo.log({ sessionExerciseId: sessionExercise.id, reps: 0, bodyweightKgAtTime: 80, loggedAt: 1_000_000 })).rejects.toThrow(
      ValidationError
    );
    await expect(
      repo.log({ sessionExerciseId: sessionExercise.id, rpe: 5, bodyweightKgAtTime: 80, loggedAt: 1_000_000 })
    ).rejects.toThrow(ValidationError);
    await expect(
      repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: Date.now() + 120_000 })
    ).rejects.toThrow(ValidationError);
    expect(await db.sets.count()).toBe(0);
    db.close();
  });

  it("log() rejects a nonexistent or deleted sessionExercise", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    await expect(repo.log({ sessionExerciseId: "nope", bodyweightKgAtTime: 80, loggedAt: 1000 })).rejects.toThrow();

    const { sessionExercise } = await setupSession(db);
    const sessionExercises = createSessionExerciseRepository(db);
    await sessionExercises.softDelete(sessionExercise.id);
    await expect(repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1000 })).rejects.toThrow();
    db.close();
  });

  it("log() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { sessionExercise } = await setupSession(db);
    const repo = createSetRepository(db);
    await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
    const queued = await db.syncQueue.where("entityType").equals("set").toArray();
    expect(queued.length).toBe(1);
    db.close();
  });

  it("log() bumps the parent session's lastActivityAt", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { session, sessionExercise } = await setupSession(db);
    const repo = createSetRepository(db);
    await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_005_000 });

    const updatedSession = await db.sessions.get(session.id);
    expect(updatedSession?.lastActivityAt).toBe(1_005_000);
    db.close();
  });

  it("log() derives restBeforeSec from the most recent set logged anywhere in the session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { session, sessionExercise } = await setupSession(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const repo = createSetRepository(db);

    const first = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
    expect(first.restBeforeSec).toBeNull(); // nothing logged before it

    const squatSe = await sessionExercises.add({ sessionId: session.id, exerciseId: SQUAT });
    const second = await repo.log({ sessionExerciseId: squatSe.id, bodyweightKgAtTime: 80, loggedAt: 1_090_000 });
    expect(second.restBeforeSec).toBe(90); // 90,000ms since the bench set, across exercises
    db.close();
  });

  describe("update()", () => {
    it("patches fields and stamps updatedAt/deviceId, clearing syncedAt", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { sessionExercise } = await setupSession(db);
      const repo = createSetRepository(db);
      const before = Date.now();
      const set = await repo.log({ sessionExerciseId: sessionExercise.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });

      const updated = await repo.update(set.id, { weightKg: 65, reps: 4 });
      expect(updated.weightKg).toBe(65);
      expect(updated.reps).toBe(4);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
      expect(updated.deviceId).toBe(await db.getDeviceId());
      expect(updated.syncedAt).toBeNull();
      db.close();
    });

    it("rejects an out-of-bounds patch", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { sessionExercise } = await setupSession(db);
      const repo = createSetRepository(db);
      const set = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
      await expect(repo.update(set.id, { rpe: 11 })).rejects.toThrow(ValidationError);
      db.close();
    });

    it("rejects updating a nonexistent or deleted set", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { sessionExercise } = await setupSession(db);
      const repo = createSetRepository(db);
      await expect(repo.update("nope", { weightKg: 10 })).rejects.toThrow();

      const set = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
      await repo.softDelete(set.id);
      await expect(repo.update(set.id, { weightKg: 10 })).rejects.toThrow();
      db.close();
    });

    it("moving to a different sessionExercise re-scopes orderIndex and recomputes exerciseId", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { session, sessionExercise } = await setupSession(db);
      const sessionExercises = createSessionExerciseRepository(db);
      const squatSe = await sessionExercises.add({ sessionId: session.id, exerciseId: SQUAT });
      const repo = createSetRepository(db);

      await repo.log({ sessionExerciseId: squatSe.id, bodyweightKgAtTime: 80, loggedAt: 999_000 });
      const strayBench = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });

      const moved = await repo.update(strayBench.id, { sessionExerciseId: squatSe.id });
      expect(moved.sessionExerciseId).toBe(squatSe.id);
      expect(moved.exerciseId).toBe(SQUAT);
      expect(moved.orderIndex).toBe(2000);
      db.close();
    });

    it("recomputes restBeforeSec when loggedAt is patched", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { sessionExercise } = await setupSession(db);
      const repo = createSetRepository(db);

      await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
      const second = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_060_000 });
      expect(second.restBeforeSec).toBe(60);

      const retimed = await repo.update(second.id, { loggedAt: 1_120_000 });
      expect(retimed.restBeforeSec).toBe(120);
      db.close();
    });
  });

  describe("softDelete / listBySessionExercise", () => {
    it("softDelete excludes a set from listBySessionExercise", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { sessionExercise } = await setupSession(db);
      const repo = createSetRepository(db);
      const set = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
      await repo.softDelete(set.id);
      expect(await repo.listBySessionExercise(sessionExercise.id)).toEqual([]);
      db.close();
    });

    it("lists sets for one sessionExercise, ordered, excluding other sessionExercises", async () => {
      const db = new GymDatabase(uniqueDbName());
      const { session, sessionExercise } = await setupSession(db);
      const sessionExercises = createSessionExerciseRepository(db);
      const squatSe = await sessionExercises.add({ sessionId: session.id, exerciseId: SQUAT });
      const repo = createSetRepository(db);

      const a = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_000_000 });
      const b = await repo.log({ sessionExerciseId: sessionExercise.id, bodyweightKgAtTime: 80, loggedAt: 1_010_000 });
      await repo.log({ sessionExerciseId: squatSe.id, bodyweightKgAtTime: 80, loggedAt: 1_020_000 });

      const list = await repo.listBySessionExercise(sessionExercise.id);
      expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
      db.close();
    });
  });
});
