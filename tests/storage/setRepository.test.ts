import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "bench-press";
const SQUAT = "back-squat";
const SESSION_A = "session-a";
const SESSION_B = "session-b";

describe("SetRepository writes", () => {
  it("log() writes a durable set with orderIndex 0", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const set = await repo.log({
      sessionId: SESSION_A,
      exerciseId: BENCH,
      weightKg: 60,
      reps: 5,
      bodyweightKgAtTime: 80,
      loggedAt: 1000,
    });
    expect(set.orderIndex).toBe(0);
    expect(await db.sets.get(set.id)).toBeDefined();
    db.close();
  });

  it("log() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    const queued = await db.syncQueue.where("entityType").equals("set").toArray();
    expect(queued.length).toBe(1);
    db.close();
  });

  it("log() defaults omitted load fields to null", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const set = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    expect(set.weightKg).toBeNull();
    expect(set.reps).toBeNull();
    expect(set.durationSec).toBeNull();
    expect(set.distanceM).toBeNull();
    expect(set.rpe).toBeNull();
    db.close();
  });

  it("orderIndex increments per (session, exercise) and is independent across exercises", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const bench1 = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    const squat1 = await repo.log({ sessionId: SESSION_A, exerciseId: SQUAT, bodyweightKgAtTime: 80, loggedAt: 1100 });
    const bench2 = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1200 });

    expect(bench1.orderIndex).toBe(0);
    expect(squat1.orderIndex).toBe(0);
    expect(bench2.orderIndex).toBe(1);
    db.close();
  });

  it("orderIndex does not renumber after a soft delete", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const first = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1100 });
    await repo.softDelete(first.id);
    const third = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1200 });
    expect(third.orderIndex).toBe(2);
    db.close();
  });

  it("update() patches fields and stamps updatedAt/deviceId, clearing syncedAt", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const before = Date.now();
    const set = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
    const updated = await repo.update(set.id, { weightKg: 65, reps: 4 });

    expect(updated.weightKg).toBe(65);
    expect(updated.reps).toBe(4);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    expect(updated.deviceId).toBe(await db.getDeviceId());
    expect(updated.syncedAt).toBeNull();
    db.close();
  });

  it("update() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const set = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await repo.update(set.id, { weightKg: 70 });
    const queued = await db.syncQueue.where("entityType").equals("set").toArray();
    expect(queued.length).toBe(2); // one from log(), one from update()
    db.close();
  });

  it("update() rejects a nonexistent or deleted set", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    await expect(repo.update("nope", { weightKg: 10 })).rejects.toThrow();

    const set = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await repo.softDelete(set.id);
    await expect(repo.update(set.id, { weightKg: 10 })).rejects.toThrow();
    db.close();
  });

  it("update() moving a set to a new exercise re-scopes orderIndex to the back of that group", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    await repo.log({ sessionId: SESSION_A, exerciseId: SQUAT, bodyweightKgAtTime: 80, loggedAt: 900 });
    const strayBench = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });

    const moved = await repo.update(strayBench.id, { exerciseId: SQUAT });
    expect(moved.exerciseId).toBe(SQUAT);
    expect(moved.orderIndex).toBe(1);
    db.close();
  });

  it("softDelete() excludes a set from listBySession", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const set = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await repo.softDelete(set.id);
    expect(await repo.listBySession(SESSION_A)).toEqual([]);
    db.close();
  });

  it("listBySession returns only that session's sets, ordered chronologically", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSetRepository(db);
    const b = await repo.log({ sessionId: SESSION_A, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 2000 });
    const a = await repo.log({ sessionId: SESSION_A, exerciseId: SQUAT, bodyweightKgAtTime: 80, loggedAt: 1000 });
    await repo.log({ sessionId: SESSION_B, exerciseId: BENCH, bodyweightKgAtTime: 80, loggedAt: 1500 });

    const sets = await repo.listBySession(SESSION_A);
    expect(sets.map((s) => s.id)).toEqual([a.id, b.id]);
    db.close();
  });
});
