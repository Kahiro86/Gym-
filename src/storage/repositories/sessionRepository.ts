import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import type { GymDatabase } from "../db.js";
import type { SessionRecord } from "../types.js";

export interface NewSession {
  startedAt: number;
  note?: string | null;
  routineId?: string | null;
}

export interface SessionRepository {
  create(input: NewSession): Promise<SessionRecord>;
  getById(id: string): Promise<SessionRecord | null>;
  getActive(): Promise<SessionRecord | null>;
  finish(id: string, endedAt: number): Promise<void>;
  listRecent(limit: number, before?: number): Promise<SessionRecord[]>;
  softDelete(id: string): Promise<void>;
}

async function findActive(db: GymDatabase): Promise<SessionRecord | undefined> {
  return db.sessions.filter((s) => s.endedAt === null && s.deletedAt === null).first();
}

export function createSessionRepository(db: GymDatabase): SessionRepository {
  return {
    async create(input) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessions, db.syncQueue, async () => {
        // A single active session is enforced here, not auto-resolved —
        // silently finishing a stray active session could quietly cut off
        // a workout the user is still mid-set on.
        const existingActive = await findActive(db);
        if (existingActive) {
          throw new Error(`Cannot start a new session — session ${existingActive.id} is still active. Finish or delete it first.`);
        }

        const record: SessionRecord = {
          id: newId(),
          startedAt: input.startedAt,
          endedAt: null,
          note: input.note ?? null,
          routineId: input.routineId ?? null,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
        };
        await db.sessions.add(record);
        await enqueueSync(db, "session", record.id, "upsert");
        return record;
      });
    },

    async getById(id) {
      const record = await db.sessions.get(id);
      return record && record.deletedAt === null ? record : null;
    },

    async getActive() {
      const record = await findActive(db);
      return record ?? null;
    },

    async finish(id, endedAt) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessions, db.syncQueue, async () => {
        await db.sessions.update(id, { endedAt, updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "session", id, "upsert");
      });
    },

    async listRecent(limit, before) {
      return db.sessions
        .orderBy("startedAt")
        .reverse()
        .filter((s) => s.deletedAt === null && (before === undefined || s.startedAt < before))
        .limit(limit)
        .toArray();
    },

    async softDelete(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessions, db.syncQueue, async () => {
        await db.sessions.update(id, { deletedAt: now(), updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "session", id, "upsert");
      });
    },
  };
}
