import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";
const SQUAT = "back-squat";
const SESSION = "session-a";

describe("SessionExerciseRepository", () => {
  it("add() assigns sparse orderIndex values (increments of 1000)", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionExerciseRepository(db);
    const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
    const b = await repo.add({ sessionId: SESSION, exerciseId: SQUAT });
    expect(a.orderIndex).toBe(1000);
    expect(b.orderIndex).toBe(2000);
    db.close();
  });

  it("add() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionExerciseRepository(db);
    await repo.add({ sessionId: SESSION, exerciseId: BENCH });
    const queued = await db.syncQueue.where("entityType").equals("sessionExercise").toArray();
    expect(queued.length).toBe(1);
    db.close();
  });

  it("add() defaults optional fields to null", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionExerciseRepository(db);
    const record = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
    expect(record.supersetGroup).toBeNull();
    expect(record.note).toBeNull();
    expect(record.substitutedFromId).toBeNull();
    expect(record.plannedFromRoutineExerciseId).toBeNull();
    db.close();
  });

  it("listBySession returns entries ordered by orderIndex, excluding soft-deleted and other sessions", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionExerciseRepository(db);
    const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
    const b = await repo.add({ sessionId: SESSION, exerciseId: SQUAT });
    const deleted = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
    await repo.add({ sessionId: "other-session", exerciseId: BENCH });
    await repo.softDelete(deleted.id);

    const list = await repo.listBySession(SESSION);
    expect(list.map((r) => r.id)).toEqual([a.id, b.id]);
    db.close();
  });

  describe("reorder", () => {
    it("moves an entry between two others by averaging orderIndex", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH }); // 1000
      const b = await repo.add({ sessionId: SESSION, exerciseId: SQUAT }); // 2000
      const c = await repo.add({ sessionId: SESSION, exerciseId: BENCH }); // 3000

      const moved = await repo.reorder(c.id, a.id, b.id);
      expect(moved.orderIndex).toBeGreaterThan(a.orderIndex);
      expect(moved.orderIndex).toBeLessThan(b.orderIndex);

      const list = await repo.listBySession(SESSION);
      expect(list.map((r) => r.id)).toEqual([a.id, c.id, b.id]);
      db.close();
    });

    it("moving to the very front (beforeId null) lands before everything else", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      const b = await repo.add({ sessionId: SESSION, exerciseId: SQUAT });

      await repo.reorder(b.id, null, a.id);
      const list = await repo.listBySession(SESSION);
      expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
      db.close();
    });

    it("moving to the very end (afterId null) lands after everything else", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      const b = await repo.add({ sessionId: SESSION, exerciseId: SQUAT });

      await repo.reorder(a.id, b.id, null);
      const list = await repo.listBySession(SESSION);
      expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
      db.close();
    });

    it("renormalizes the whole session when the gap between neighbors has closed", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      const b = await repo.add({ sessionId: SESSION, exerciseId: SQUAT });
      const c = await repo.add({ sessionId: SESSION, exerciseId: BENCH });

      // Simulate an exhausted gap directly (as many repeated reorders
      // would eventually produce): a and b are adjacent integers.
      await db.sessionExercises.update(a.id, { orderIndex: 1000 });
      await db.sessionExercises.update(b.id, { orderIndex: 1001 });

      const moved = await repo.reorder(c.id, a.id, b.id);

      // Renormalization re-spaces a and b (the pre-existing order: a, b, c
      // by current orderIndex) to clean 1000-multiples *before* c is
      // placed between them, so c lands at their midpoint — 1500, not
      // another 1000-multiple, but still correctly between a (1000) and
      // the renormalized b (2000).
      expect(moved.orderIndex).toBe(1500);
      const list = await repo.listBySession(SESSION);
      expect(list.map((r) => r.id)).toEqual([a.id, c.id, b.id]);
      expect(list.map((r) => r.orderIndex)).toEqual([1000, 1500, 2000]);
      db.close();
    });

    it("rejects reordering a nonexistent or deleted entry", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      await expect(repo.reorder("nope", null, null)).rejects.toThrow();

      const a = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      await repo.softDelete(a.id);
      await expect(repo.reorder(a.id, null, null)).rejects.toThrow();
      db.close();
    });
  });

  describe("substitute", () => {
    it("changes the exercise and records substitutedFromId", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const record = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      const updated = await repo.substitute(record.id, SQUAT);
      expect(updated.exerciseId).toBe(SQUAT);
      expect(updated.substitutedFromId).toBe(BENCH);
      db.close();
    });

    it("enqueues a sync entry", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const record = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      await repo.substitute(record.id, SQUAT);
      const queued = await db.syncQueue.where("entityType").equals("sessionExercise").toArray();
      expect(queued.length).toBe(2); // add() + substitute()
      db.close();
    });
  });

  describe("softDelete", () => {
    it("excludes the entry from listBySession", async () => {
      const db = new GymDatabase(uniqueDbName());
      const repo = createSessionExerciseRepository(db);
      const record = await repo.add({ sessionId: SESSION, exerciseId: BENCH });
      await repo.softDelete(record.id);
      expect(await repo.listBySession(SESSION)).toEqual([]);
      expect(await repo.getById(record.id)).toBeNull();
      db.close();
    });
  });
});
