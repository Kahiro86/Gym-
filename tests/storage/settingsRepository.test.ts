import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createSettingsRepository } from "../../src/storage/repositories/settingsRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("SettingsRepository", () => {
  it("get() returns sane defaults on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSettingsRepository(db);
    const settings = await repo.get();
    expect(settings.units).toBe("kg");
    expect(settings.weeklyTargetSessions).toBeNull();
    expect(settings.defaultRestSeconds).toBe(120);
    db.close();
  });

  it("get() is stable — the same singleton row every call", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSettingsRepository(db);
    const a = await repo.get();
    const b = await repo.get();
    expect(a.installDeviceId).toBe(b.installDeviceId);
    db.close();
  });

  it("update() patches only the given fields", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSettingsRepository(db);
    await repo.update({ units: "lb" });
    const updated = await repo.update({ weeklyTargetSessions: 4 });
    expect(updated.units).toBe("lb");
    expect(updated.weeklyTargetSessions).toBe(4);
    db.close();
  });

  it("update() stamps updatedAt/deviceId and clears syncedAt", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSettingsRepository(db);
    const before = Date.now();
    const updated = await repo.update({ defaultRestSeconds: 90 });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    expect(updated.deviceId).toBe(await db.getDeviceId());
    expect(updated.syncedAt).toBeNull();
    db.close();
  });

  it("update() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createSettingsRepository(db);
    await repo.update({ units: "lb" });
    const queued = await db.syncQueue.where("entityType").equals("settings").toArray();
    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0]!.mutationId).toBeTruthy();
    db.close();
  });

  it("persists updates across reopen", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    await createSettingsRepository(db1).update({ units: "lb" });
    db1.close();

    const db2 = new GymDatabase(name);
    const settings = await createSettingsRepository(db2).get();
    expect(settings.units).toBe("lb");
    db2.close();
  });
});
