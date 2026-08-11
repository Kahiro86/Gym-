import { describe, it, expect, afterEach } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { ensurePersistenceRequested, checkStorageEstimate, isApproachingQuota, shouldPromptInstallToHomeScreen } from "../../src/storage/persistence.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";
import { createSessionExerciseRepository } from "../../src/storage/repositories/sessionExerciseRepository.js";
import { createSetRepository } from "../../src/storage/repositories/setRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

const BENCH = "barbell-bench-press";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function mockNavigatorStorage(storage: Partial<StorageManager> | undefined): void {
  Object.defineProperty(globalThis, "navigator", { value: storage ? { storage } : {}, configurable: true });
}

function restoreNavigator(): void {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  }
}

describe("persistence", () => {
  afterEach(() => {
    restoreNavigator();
  });

  describe("ensurePersistenceRequested", () => {
    it("calls navigator.storage.persist() and records the outcome when granted", async () => {
      mockNavigatorStorage({ persist: async () => true } as Partial<StorageManager>);
      const db = new GymDatabase(uniqueDbName());
      await ensurePersistenceRequested(db);

      const deviceSettings = await db.getOrCreateDeviceSettings();
      expect(deviceSettings.persistenceRequested).toBe(true);
      expect(deviceSettings.persistenceGranted).toBe(true);
      db.close();
    });

    it("records granted: false when the browser denies persistence", async () => {
      mockNavigatorStorage({ persist: async () => false } as Partial<StorageManager>);
      const db = new GymDatabase(uniqueDbName());
      await ensurePersistenceRequested(db);

      const deviceSettings = await db.getOrCreateDeviceSettings();
      expect(deviceSettings.persistenceRequested).toBe(true);
      expect(deviceSettings.persistenceGranted).toBe(false);
      db.close();
    });

    it("only ever calls persist() once per device, even across many calls", async () => {
      let callCount = 0;
      mockNavigatorStorage({
        persist: async () => {
          callCount++;
          return true;
        },
      } as Partial<StorageManager>);
      const db = new GymDatabase(uniqueDbName());

      await ensurePersistenceRequested(db);
      await ensurePersistenceRequested(db);
      await ensurePersistenceRequested(db);

      expect(callCount).toBe(1);
      db.close();
    });

    it("does not throw when navigator.storage is unavailable, and does not mark granted", async () => {
      mockNavigatorStorage(undefined);
      const db = new GymDatabase(uniqueDbName());
      await expect(ensurePersistenceRequested(db)).resolves.toBeUndefined();

      const deviceSettings = await db.getOrCreateDeviceSettings();
      expect(deviceSettings.persistenceRequested).toBe(true);
      expect(deviceSettings.persistenceGranted).toBe(false);
      db.close();
    });

    it("does not throw when persist() itself rejects", async () => {
      mockNavigatorStorage({
        persist: async () => {
          throw new Error("permission API unavailable");
        },
      } as Partial<StorageManager>);
      const db = new GymDatabase(uniqueDbName());
      await expect(ensurePersistenceRequested(db)).resolves.toBeUndefined();
      expect((await db.getOrCreateDeviceSettings()).persistenceGranted).toBe(false);
      db.close();
    });

    it("fires from setRepository.log() at the first meaningful write", async () => {
      let callCount = 0;
      mockNavigatorStorage({
        persist: async () => {
          callCount++;
          return true;
        },
      } as Partial<StorageManager>);
      const db = new GymDatabase(uniqueDbName());
      const sessions = createSessionRepository(db);
      const sessionExercises = createSessionExerciseRepository(db);
      const sets = createSetRepository(db);

      expect(callCount).toBe(0);
      const session = await sessions.create({ startedAt: 1000 });
      const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
      await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });

      expect(callCount).toBe(1);
      await sets.log({ sessionExerciseId: se.id, weightKg: 65, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1100 });
      expect(callCount).toBe(1); // still just once
      db.close();
    });
  });

  describe("checkStorageEstimate", () => {
    it("returns usage/quota/ratio when the API is available", async () => {
      mockNavigatorStorage({ estimate: async () => ({ usage: 25, quota: 100 }) } as Partial<StorageManager>);
      const estimate = await checkStorageEstimate();
      expect(estimate).toEqual({ usageBytes: 25, quotaBytes: 100, usageRatio: 0.25 });
    });

    it("returns undefined when unavailable", async () => {
      mockNavigatorStorage(undefined);
      expect(await checkStorageEstimate()).toBeUndefined();
    });

    it("returns undefined when estimate() rejects", async () => {
      mockNavigatorStorage({
        estimate: async () => {
          throw new Error("not supported");
        },
      } as Partial<StorageManager>);
      expect(await checkStorageEstimate()).toBeUndefined();
    });
  });

  describe("isApproachingQuota", () => {
    it("is true at or above the warning threshold", () => {
      expect(isApproachingQuota({ usageBytes: 80, quotaBytes: 100, usageRatio: 0.8 })).toBe(true);
      expect(isApproachingQuota({ usageBytes: 90, quotaBytes: 100, usageRatio: 0.9 })).toBe(true);
    });

    it("is false below the warning threshold", () => {
      expect(isApproachingQuota({ usageBytes: 50, quotaBytes: 100, usageRatio: 0.5 })).toBe(false);
    });
  });

  describe("shouldPromptInstallToHomeScreen", () => {
    it("is false with no completed sessions", async () => {
      const db = new GymDatabase(uniqueDbName());
      expect(await shouldPromptInstallToHomeScreen(db)).toBe(false);
      db.close();
    });

    it("is true once a session has completed", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sessions = createSessionRepository(db);
      const sessionExercises = createSessionExerciseRepository(db);
      const sets = createSetRepository(db);
      const session = await sessions.create({ startedAt: 1000 });
      const se = await sessionExercises.add({ sessionId: session.id, exerciseId: BENCH });
      await sets.log({ sessionExerciseId: se.id, weightKg: 60, reps: 5, bodyweightKgAtTime: 80, loggedAt: 1000 });
      await sessions.finish(session.id, 2000);

      expect(await shouldPromptInstallToHomeScreen(db)).toBe(true);
      db.close();
    });

    it("stays false for a discarded (zero-completed-set) session", async () => {
      const db = new GymDatabase(uniqueDbName());
      const sessions = createSessionRepository(db);
      const session = await sessions.create({ startedAt: 1000 });
      await sessions.finish(session.id, 2000); // no sets -> discarded
      expect(await shouldPromptInstallToHomeScreen(db)).toBe(false);
      db.close();
    });
  });
});
