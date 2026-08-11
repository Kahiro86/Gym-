import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createDeviceSettingsRepository } from "../../src/storage/repositories/deviceSettingsRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("DeviceSettingsRepository", () => {
  it("get() returns sane defaults on a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createDeviceSettingsRepository(db);
    const settings = await repo.get();
    expect(settings.theme).toBe("system");
    expect(settings.reduceMotion).toBe(false);
    expect(settings.soundEnabled).toBe(true);
    expect(settings.restTimerAutoStart).toBe(true);
    expect(settings.persistenceGranted).toBe(false);
    db.close();
  });

  it("update() patches only the given fields", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createDeviceSettingsRepository(db);
    await repo.update({ theme: "dark" });
    const updated = await repo.update({ soundEnabled: false });
    expect(updated.theme).toBe("dark");
    expect(updated.soundEnabled).toBe(false);
    db.close();
  });

  it("never carries sync columns and never enqueues to syncQueue", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createDeviceSettingsRepository(db);
    const updated = await repo.update({ theme: "dark" });
    expect("deviceId" in updated).toBe(false);
    expect("syncedAt" in updated).toBe(false);
    expect("deletedAt" in updated).toBe(false);
    expect(await db.syncQueue.count()).toBe(0);
    db.close();
  });

  it("persists updates across reopen, independent of the synced settings row", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    await createDeviceSettingsRepository(db1).update({ theme: "dark", restTimerAutoStart: false });
    db1.close();

    const db2 = new GymDatabase(name);
    const settings = await createDeviceSettingsRepository(db2).get();
    expect(settings.theme).toBe("dark");
    expect(settings.restTimerAutoStart).toBe(false);
    db2.close();
  });
});
