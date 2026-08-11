import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { enqueueSync } from "../../src/storage/syncQueue.js";
import { createSettingsRepository } from "../../src/storage/repositories/settingsRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createExerciseRepository } from "../../src/storage/repositories/exerciseRepository.js";
import { createRoutineRepository } from "../../src/storage/repositories/routineRepository.js";
import { seedCatalog } from "../../src/storage/seed.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

describe("syncQueue", () => {
  describe("enqueueSync", () => {
    it("writes a queue entry with a mutationId, zero attempts, and a createdAt stamp", async () => {
      const db = new GymDatabase(uniqueDbName());
      const before = Date.now();
      await db.transaction("rw", db.syncQueue, async () => {
        await enqueueSync(db, "session", "session-1", "upsert");
      });

      const rows = await db.syncQueue.toArray();
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({ entityType: "session", entityId: "session-1", operation: "upsert", attempts: 0 });
      expect(rows[0]!.id).toBeTruthy();
      expect(rows[0]!.mutationId).toBeTruthy();
      expect(rows[0]!.mutationId).not.toBe(rows[0]!.id);
      expect(rows[0]!.createdAt).toBeGreaterThanOrEqual(before);
      db.close();
    });

    it("generates a distinct mutationId per enqueue", async () => {
      const db = new GymDatabase(uniqueDbName());
      await db.transaction("rw", db.syncQueue, async () => {
        await enqueueSync(db, "session", "session-1", "upsert");
        await enqueueSync(db, "session", "session-1", "upsert");
      });
      const rows = await db.syncQueue.toArray();
      expect(rows[0]!.mutationId).not.toBe(rows[1]!.mutationId);
      db.close();
    });

    it("a failed write leaves no orphaned syncQueue entry", async () => {
      const db = new GymDatabase(uniqueDbName());
      const set = {
        id: "dup",
        sessionExerciseId: "se1",
        exerciseId: BENCH,
        orderIndex: 1000,
        weightKg: 60,
        reps: 5,
        durationSec: null,
        distanceM: null,
        rpe: null,
        isWarmup: false,
        completed: true,
        targetReps: null,
        note: null,
        bodyweightKgAtTime: 80,
        loggedAt: 0,
        restBeforeSec: null,
        updatedAt: Date.now(),
        deletedAt: null,
        deviceId: "d",
        syncedAt: null,
        serverUpdatedAt: null,
      };

      await expect(
        db.transaction("rw", db.sets, db.syncQueue, async () => {
          await db.sets.add(set);
          await enqueueSync(db, "set", set.id, "upsert");
          // Same primary key again — Dexie throws ConstraintError, aborting
          // the whole transaction, including the enqueue above.
          await db.sets.add(set);
        })
      ).rejects.toThrow();

      expect(await db.sets.count()).toBe(0);
      expect(await db.syncQueue.count()).toBe(0);
      db.close();
    });
  });

  it("accumulates exactly one entry per mutation across a realistic sequence of v2 repository writes", async () => {
    const db = new GymDatabase(uniqueDbName());
    const settings = createSettingsRepository(db);
    const sessions = createSessionRepository(db);
    const sessionExercises = createSessionExerciseRepository(db);
    const sets = createSetRepository(db);
    const exercises = createExerciseRepository(db);
    const routines = createRoutineRepository(db);

    await settings.update({ units: "lb" }); // 1
    const routine = await routines.create({ name: "Push Day" }); // 2
    const session = await sessions.create({ startedAt: 1000, routineId: routine.id }); // 3
    const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH }); // 4
    const set = await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 }); // 5
    await sets.update(set.id, { weightKg: 65 }); // 6
    const custom = await exercises.createCustom({
      name: "Garage Press",
      loadType: "barbell",
      primaryGroup: "shoulders",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
      equipment: ["barbell"],
      defaultRestSeconds: 90,
    }); // 7
    await exercises.hide(custom.id); // 8
    await sets.softDelete(set.id); // 9
    await sessions.finish(session.id, 2000); // 10 (discarded, since its only set is now deleted)

    const rows = await db.syncQueue.toArray();
    expect(rows.length).toBe(10);

    const byType = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.entityType] = (acc[r.entityType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ settings: 1, routine: 1, session: 2, sessionExercise: 1, set: 3, exercise: 2 });
    expect(rows.every((r) => r.operation === "upsert")).toBe(true);
    expect(new Set(rows.map((r) => r.mutationId)).size).toBe(rows.length); // every mutationId distinct
    db.close();
  });

  it("never enqueues built-in catalog rows seeded by seedCatalog", async () => {
    const db = new GymDatabase(uniqueDbName());
    await seedCatalog(db);
    expect(await db.syncQueue.where("entityType").equals("exercise").count()).toBe(0);
    db.close();
  });
});
