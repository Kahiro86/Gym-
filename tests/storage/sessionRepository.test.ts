import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSessionRepository } from "../../src/storage/repositories/sessionRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("SessionRepository", () => {
  it("create() writes a durable, in-progress session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const session = await repo.create({ startedAt: 1000 });
    expect(session.endedAt).toBeNull();
    expect(await db.sessions.get(session.id)).toBeDefined();
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
    await repo.finish(session.id, 2000);
    await repo.softDelete(session.id);
    expect(await repo.getById(session.id)).toBeNull();
    db.close();
  });

  it("getActive returns the in-progress session, null once finished", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const session = await repo.create({ startedAt: 1000 });
    expect((await repo.getActive())?.id).toBe(session.id);

    await repo.finish(session.id, 2000);
    expect(await repo.getActive()).toBeNull();
    db.close();
  });

  it("enforces a single active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    await repo.create({ startedAt: 1000 });
    await expect(repo.create({ startedAt: 2000 })).rejects.toThrow(/still active/);
    db.close();
  });

  it("allows a new session once the active one is finished", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const first = await repo.create({ startedAt: 1000 });
    await repo.finish(first.id, 1500);
    await expect(repo.create({ startedAt: 2000 })).resolves.toBeDefined();
    db.close();
  });

  it("allows a new session once the active one is soft-deleted", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const first = await repo.create({ startedAt: 1000 });
    await repo.softDelete(first.id);
    await expect(repo.create({ startedAt: 2000 })).resolves.toBeDefined();
    db.close();
  });

  it("listRecent excludes soft-deleted sessions and orders newest-first", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const a = await repo.create({ startedAt: 1000 });
    await repo.finish(a.id, 1100);
    const b = await repo.create({ startedAt: 2000 });
    await repo.finish(b.id, 2100);
    const c = await repo.create({ startedAt: 3000 });
    await repo.finish(c.id, 3100);
    await repo.softDelete(b.id);

    const recent = await repo.listRecent(10);
    expect(recent.map((s) => s.id)).toEqual([c.id, a.id]);
    db.close();
  });

  it("listRecent paginates with the `before` cursor", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSessionRepository(db);
    const a = await repo.create({ startedAt: 1000 });
    await repo.finish(a.id, 1100);
    const b = await repo.create({ startedAt: 2000 });
    await repo.finish(b.id, 2100);

    const page = await repo.listRecent(10, 2000);
    expect(page.map((s) => s.id)).toEqual([a.id]);
    db.close();
  });
});
