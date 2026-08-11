import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";
import { createProfileRepository } from "../../src/storage/repositories/profileRepository.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("ProfileRepository", () => {
  it("get() returns null-valued defaults on a fresh database, as its own first write", async () => {
    // Regression coverage: getOrCreateProfile() used to call getDeviceId()
    // *inside* its own db.profile-only transaction, which throws
    // SubTransactionError the moment this is the very first call against a
    // brand-new database (getDeviceId's own settings lookup isn't part of
    // that transaction's table set). Calling get() first, before anything
    // else has warmed the device-id cache, is exactly the failure case.
    const db = new GymDatabase(uniqueDbName());
    const repo = createProfileRepository(db);
    const profile = await repo.get();
    expect(profile.heightCm).toBeNull();
    expect(profile.birthDate).toBeNull();
    expect(profile.sex).toBeNull();
    db.close();
  });

  it("get() is stable — the same singleton row every call", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createProfileRepository(db);
    const a = await repo.get();
    const b = await repo.get();
    expect(a.updatedAt).toBe(b.updatedAt);
    db.close();
  });

  it("update() patches only the given fields, as its own first write against a fresh database", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createProfileRepository(db);
    const updated = await repo.update({ heightCm: 180, sex: "unspecified" });
    expect(updated.heightCm).toBe(180);
    expect(updated.sex).toBe("unspecified");
    expect(updated.birthDate).toBeNull();
    db.close();
  });

  it("update() stamps updatedAt/deviceId and clears syncedAt", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createProfileRepository(db);
    const before = Date.now();
    const updated = await repo.update({ heightCm: 175 });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    expect(updated.deviceId).toBe(await db.getDeviceId());
    expect(updated.syncedAt).toBeNull();
    db.close();
  });

  it("update() enqueues a sync entry", async () => {
    const db = new GymDatabase(uniqueDbName());
    const repo = createProfileRepository(db);
    await repo.update({ heightCm: 175 });
    const queued = await db.syncQueue.where("entityType").equals("profile").toArray();
    expect(queued.length).toBe(1);
    db.close();
  });

  it("persists updates across reopen", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    await createProfileRepository(db1).update({ heightCm: 165, birthDate: "1990-05-01" });
    db1.close();

    const db2 = new GymDatabase(name);
    const profile = await createProfileRepository(db2).get();
    expect(profile.heightCm).toBe(165);
    expect(profile.birthDate).toBe("1990-05-01");
    db2.close();
  });
});
