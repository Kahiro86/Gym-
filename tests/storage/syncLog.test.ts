import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { recordSyncAttempt, getRecentSyncLog, getSyncQueueDepth } from "../../src/storage/syncLog.js";
import { enqueueSync } from "../../src/storage/syncQueue.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("syncLog", () => {
  it("recordSyncAttempt writes a durable entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    await recordSyncAttempt(db, "push", { session: 3, set: 12 }, "success");
    const rows = await db.syncLog.toArray();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ direction: "push", outcome: "success", error: null, entityCounts: { session: 3, set: 12 } });
    db.close();
  });

  it("records a failure with its error message", async () => {
    const db = new GymDatabase(uniqueDbName());
    await recordSyncAttempt(db, "pull", {}, "failure", "network timeout");
    const rows = await db.syncLog.toArray();
    expect(rows[0]).toMatchObject({ outcome: "failure", error: "network timeout" });
    db.close();
  });

  describe("getRecentSyncLog", () => {
    it("returns entries newest-first", async () => {
      const db = new GymDatabase(uniqueDbName());
      await db.syncLog.bulkAdd([
        { id: "a", timestamp: 1000, direction: "push", entityCounts: {}, outcome: "success", error: null },
        { id: "b", timestamp: 3000, direction: "push", entityCounts: {}, outcome: "success", error: null },
        { id: "c", timestamp: 2000, direction: "pull", entityCounts: {}, outcome: "success", error: null },
      ]);
      const recent = await getRecentSyncLog(db);
      expect(recent.map((r) => r.id)).toEqual(["b", "c", "a"]);
      db.close();
    });

    it("respects an explicit limit", async () => {
      const db = new GymDatabase(uniqueDbName());
      await db.syncLog.bulkAdd(
        Array.from({ length: 10 }, (_, i) => ({
          id: `e${i}`,
          timestamp: i,
          direction: "push" as const,
          entityCounts: {},
          outcome: "success" as const,
          error: null,
        }))
      );
      expect((await getRecentSyncLog(db, 3)).length).toBe(3);
      db.close();
    });
  });

  it("trims to the most recent 200 entries once the log exceeds that", async () => {
    const db = new GymDatabase(uniqueDbName());
    // Seed 200 old entries directly (bulkAdd — fast), then record one more
    // through the real API to exercise the trim path.
    await db.syncLog.bulkAdd(
      Array.from({ length: 200 }, (_, i) => ({
        id: `old-${i}`,
        timestamp: i, // oldest = timestamp 0
        direction: "push" as const,
        entityCounts: {},
        outcome: "success" as const,
        error: null,
      }))
    );
    expect(await db.syncLog.count()).toBe(200);

    await recordSyncAttempt(db, "push", {}, "success");
    expect(await db.syncLog.count()).toBe(200);
    expect(await db.syncLog.get("old-0")).toBeUndefined(); // the single oldest entry was evicted
    expect(await db.syncLog.get("old-1")).toBeDefined();
    db.close();
  });

  describe("getSyncQueueDepth", () => {
    it("reflects the current queue size", async () => {
      const db = new GymDatabase(uniqueDbName());
      expect(await getSyncQueueDepth(db)).toBe(0);

      await db.transaction("rw", db.syncQueue, async () => {
        await enqueueSync(db, "session", "s1", "upsert");
        await enqueueSync(db, "set", "set1", "upsert");
      });
      expect(await getSyncQueueDepth(db)).toBe(2);
      db.close();
    });
  });
});
