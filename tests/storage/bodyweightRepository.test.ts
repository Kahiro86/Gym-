import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createBodyweightRepository, findNearestInSortedLog } from "../../src/storage/repositories/bodyweightRepository.js";
import { ValidationError } from "../../src/storage/validation.js";
import type { BodyweightLogRecord } from "../../src/storage/types.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

function entry(recordedAt: number): BodyweightLogRecord {
  return {
    id: `e${recordedAt}`,
    bodyweightKg: 80,
    recordedAt,
    updatedAt: 0,
    deletedAt: null,
    deviceId: "d",
    syncedAt: null,
    serverUpdatedAt: null,
  };
}

describe("findNearestInSortedLog", () => {
  it("returns null for an empty log", () => {
    expect(findNearestInSortedLog([], 100)).toBeNull();
  });

  it("returns the only entry regardless of distance", () => {
    const only = entry(1000);
    expect(findNearestInSortedLog([only], 5000)).toBe(only);
  });

  it("returns the exact match when present", () => {
    const sorted = [entry(1000), entry(2000), entry(3000)];
    expect(findNearestInSortedLog(sorted, 2000)).toBe(sorted[1]);
  });

  it("clamps to the first entry when the timestamp is before everything", () => {
    const sorted = [entry(1000), entry(2000)];
    expect(findNearestInSortedLog(sorted, 0)).toBe(sorted[0]);
  });

  it("clamps to the last entry when the timestamp is after everything", () => {
    const sorted = [entry(1000), entry(2000)];
    expect(findNearestInSortedLog(sorted, 9999)).toBe(sorted[1]);
  });

  it("picks the closer neighbor, and the earlier one on an exact tie", () => {
    const sorted = [entry(1000), entry(2000)];
    expect(findNearestInSortedLog(sorted, 1100)).toBe(sorted[0]); // closer to 1000
    expect(findNearestInSortedLog(sorted, 1900)).toBe(sorted[1]); // closer to 2000
    expect(findNearestInSortedLog(sorted, 1500)).toBe(sorted[0]); // tie -> earlier
  });

  it("matches a linear scan across many random queries against a larger sorted log", () => {
    const sorted = Array.from({ length: 500 }, (_, i) => entry(i * 137));
    function linearNearest(timestamp: number): BodyweightLogRecord {
      return sorted.reduce((best, e) => (Math.abs(e.recordedAt - timestamp) < Math.abs(best.recordedAt - timestamp) ? e : best));
    }
    for (let q = 0; q < 200; q++) {
      const timestamp = Math.floor(Math.random() * 500 * 137);
      expect(findNearestInSortedLog(sorted, timestamp)).toEqual(linearNearest(timestamp));
    }
  });
});

describe("BodyweightRepository", () => {
  it("log() writes a durable record", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    const record = await repo.log({ bodyweightKg: 80, recordedAt: 1000 });
    expect(record.id).toBeTruthy();
    expect(await db.bodyweightLog.get(record.id)).toBeDefined();
    db.close();
  });

  it("log() rejects an out-of-bounds bodyweight", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    await expect(repo.log({ bodyweightKg: 5, recordedAt: 1000 })).rejects.toThrow(ValidationError);
    expect(await db.bodyweightLog.count()).toBe(0);
    db.close();
  });

  it("log() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    await repo.log({ bodyweightKg: 80, recordedAt: 1000 });
    const queued = await db.syncQueue.where("entityType").equals("bodyweightLog").toArray();
    expect(queued.length).toBe(1);
    db.close();
  });

  it("getNearest returns null on an empty log", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    expect(await repo.getNearest(1000)).toBeNull();
    db.close();
  });

  it("getNearest finds the closest entry on either side", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    await repo.log({ bodyweightKg: 79, recordedAt: 1000 });
    await repo.log({ bodyweightKg: 82, recordedAt: 2000 });

    expect((await repo.getNearest(1100))!.bodyweightKg).toBe(79);
    expect((await repo.getNearest(1900))!.bodyweightKg).toBe(82);
    expect((await repo.getNearest(1500))!.bodyweightKg).toBe(79); // tie -> earlier
    db.close();
  });

  it("getNearest excludes soft-deleted entries", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    const record = await repo.log({ bodyweightKg: 79, recordedAt: 1000 });
    await repo.softDelete(record.id);
    expect(await repo.getNearest(1000)).toBeNull();
    db.close();
  });

  it("listRecent returns entries newest-first, excluding soft-deleted", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    await repo.log({ bodyweightKg: 78, recordedAt: 1000 });
    const toDelete = await repo.log({ bodyweightKg: 79, recordedAt: 2000 });
    await repo.log({ bodyweightKg: 80, recordedAt: 3000 });
    await repo.softDelete(toDelete.id);

    const recent = await repo.listRecent(10);
    expect(recent.map((r) => r.bodyweightKg)).toEqual([80, 78]);
    db.close();
  });

  it("listRecent respects the limit", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    for (let i = 0; i < 5; i++) await repo.log({ bodyweightKg: 80 + i, recordedAt: 1000 + i });
    const recent = await repo.listRecent(2);
    expect(recent.length).toBe(2);
    db.close();
  });
});
