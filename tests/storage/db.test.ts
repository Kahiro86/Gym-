import { describe, it, expect } from "vitest";
import { GymDatabase } from "../../src/storage/db.js";

function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

describe("GymDatabase — schema v1", () => {
  it("opens and declares every table from §4.1", async () => {
    const db = new GymDatabase(uniqueDbName());
    await db.open();
    for (const table of ["exercises", "sessions", "sets", "bodyweightLog", "settings", "prCache", "muscleXpCache", "syncQueue"] as const) {
      expect(db[table], table).toBeDefined();
    }
    db.close();
  });

  it("write, reopen, read round-trips a record", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    await db1.open();
    await db1.sessions.add({
      id: "s1",
      startedAt: 1000,
      endedAt: null,
      note: null,
      routineId: null,
      updatedAt: 1000,
      deletedAt: null,
      deviceId: "device-a",
      syncedAt: null,
    });
    db1.close();

    const db2 = new GymDatabase(name);
    await db2.open();
    const row = await db2.sessions.get("s1");
    expect(row?.startedAt).toBe(1000);
    db2.close();
  });

  it("generates a deviceId on first run and persists it across reopen", async () => {
    const name = uniqueDbName();
    const db1 = new GymDatabase(name);
    const id1 = await db1.getDeviceId();
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    db1.close();

    const db2 = new GymDatabase(name);
    const id2 = await db2.getDeviceId();
    expect(id2).toBe(id1);
    db2.close();
  });

  it("getOrCreateSettings is idempotent under concurrent calls", async () => {
    const db = new GymDatabase(uniqueDbName());
    const [a, b, c] = await Promise.all([db.getOrCreateSettings(), db.getOrCreateSettings(), db.getOrCreateSettings()]);
    expect(a.installDeviceId).toBe(b.installDeviceId);
    expect(b.installDeviceId).toBe(c.installDeviceId);
    const count = await db.settings.count();
    expect(count).toBe(1);
    db.close();
  });

  it("defaults settings to kg units and system theme", async () => {
    const db = new GymDatabase(uniqueDbName());
    const settings = await db.getOrCreateSettings();
    expect(settings.units).toBe("kg");
    expect(settings.theme).toBe("system");
    expect(settings.weeklyTargetSessions).toBeNull();
    db.close();
  });
});
