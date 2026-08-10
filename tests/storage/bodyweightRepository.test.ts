import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createBodyweightRepository } from "../../src/storage/repositories/bodyweightRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("BodyweightRepository", () => {
  it("log() writes a durable record", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createBodyweightRepository(db);
    const record = await repo.log({ bodyweightKg: 80, recordedAt: 1000 });
    expect(record.id).toBeTruthy();
    expect(await db.bodyweightLog.get(record.id)).toBeDefined();
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

    expect((await repo.getNearest(1100))!.bodyweightKg).toBe(79); // closer to 1000
    expect((await repo.getNearest(1900))!.bodyweightKg).toBe(82); // closer to 2000
    expect((await repo.getNearest(1500))!.bodyweightKg).toBe(79); // tie -> earlier
    expect((await repo.getNearest(500))!.bodyweightKg).toBe(79); // only entry after
    expect((await repo.getNearest(3000))!.bodyweightKg).toBe(82); // only entry before
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
