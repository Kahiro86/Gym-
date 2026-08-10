import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { enqueueSync } from "../../src/storage/syncQueue.js";
import { createSettingsRepository } from "../../src/storage/repositories/settingsRepository.js";
import { createBodyweightRepository } from "../../src/storage/repositories/bodyweightRepository.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";
import { createExerciseRepository } from "../../src/storage/repositories/exerciseRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

describe("syncQueue", () => {
  describe("enqueueSync", () => {
    it("writes a queue entry with the given fields, zero attempts, and a createdAt stamp", async () => {
      const db = new GymDatabase(uniqueDbName());
      const before = Date.now();
      await db.transaction("rw", db.syncQueue, async () => {
        await enqueueSync(db, "session", "session-1", "upsert");
      });

      const rows = await db.syncQueue.toArray();
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({ entityType: "session", entityId: "session-1", operation: "upsert", attempts: 0 });
      expect(rows[0]!.id).toBeTruthy();
      expect(rows[0]!.createdAt).toBeGreaterThanOrEqual(before);
      db.close();
    });

    it("a failed write leaves no orphaned syncQueue entry", async () => {
      const db = new GymDatabase(uniqueDbName());
      const set = {
        id: "dup",
        sessionId: "s1",
        exerciseId: BENCH,
        orderIndex: 0,
        weightKg: 60,
        reps: 5,
        durationSec: null,
        distanceM: null,
        rpe: null,
        bodyweightKgAtTime: 80,
        loggedAt: 0,
        updatedAt: Date.now(),
        deletedAt: null,
        deviceId: "d",
        syncedAt: null,
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

  it("accumulates exactly one entry per mutation across a realistic sequence of repository writes", async () => {
    const db = new GymDatabase(uniqueDbName());
    const settings = createSettingsRepository(db);
    const bodyweight = createBodyweightRepository(db);
    const sessions = createSessionRepository(db);
    const sets = createSetRepository(db);
    const exercises = createExerciseRepository(db);

    await settings.update({ units: "lb" }); // 1
    await bodyweight.log({ bodyweightKg: 80, recordedAt: 1000 }); // 2
    const session = await sessions.create({ startedAt: 1000 }); // 3
    const set = await sets.log({ sessionId: session.id, exerciseId: BENCH, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 }); // 4
    await sets.update(set.id, { weightKg: 65 }); // 5
    await exercises.createCustom({
      name: "Garage Press",
      loadType: "barbell",
      limbsLoaded: 1,
      unilateral: false,
      muscles: [{ muscle: "deltAnterior", share: 1, primaryMover: true }],
      equipment: ["barbell"],
      referenceVolume: 100,
      defaultRestSeconds: 90,
    }); // 6
    await sets.softDelete(set.id); // 7
    await sessions.finish(session.id, 2000); // 8

    const rows = await db.syncQueue.toArray();
    expect(rows.length).toBe(8);

    const byType = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.entityType] = (acc[r.entityType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ settings: 1, bodyweightLog: 1, session: 2, set: 3, exercise: 1 });
    expect(rows.every((r) => r.operation === "upsert")).toBe(true);
    db.close();
  });

  it("never enqueues built-in catalog rows seeded by seedCatalog", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { seedCatalog } = await import("../../src/storage/seed.js");
    await seedCatalog(db);
    expect(await db.syncQueue.where("entityType").equals("exercise").count()).toBe(0);
    db.close();
  });
});
