import { newId, now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import { captureTzOffsetMinutes } from "../time.js";
import type { GymDatabase } from "../db.js";
import type { SessionRecord, SessionState } from "../types.js";

export interface NewSession {
  startedAt: number;
  note?: string | null;
  routineId?: string | null;
}

// §6.2: on startup, resolving a lingering in_progress session in one step
// — if it's stale (lastActivityAt older than the threshold below) this
// call has already transitioned it to "abandoned" by the time it returns,
// matching the spec's "mark abandoned and offer resume or discard".
export interface StartupSessionCheck {
  session: SessionRecord;
  isStale: boolean;
}

export interface SessionRepository {
  create(input: NewSession): Promise<SessionRecord>;
  getById(id: string): Promise<SessionRecord | null>;
  getActive(): Promise<SessionRecord | null>;
  // Discarded (not completed) when the session has zero completed sets
  // (§6.2) — a session that's all warmups-abandoned-mid-set never
  // pollutes history as an empty +0 session.
  finish(id: string, endedAt: number): Promise<void>;
  discard(id: string): Promise<void>;
  markAbandoned(id: string): Promise<void>;
  // Not in the spec's illustrative interface sketch, but required by its
  // own prose ("offer resume") — there's no other way back to in_progress.
  resume(id: string): Promise<SessionRecord>;
  checkForActiveSession(): Promise<StartupSessionCheck | null>;
  listRecent(limit: number, before?: number): Promise<SessionRecord[]>;
  softDelete(id: string): Promise<void>;
}

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

async function findActive(db: GymDatabase): Promise<SessionRecord | undefined> {
  const candidates = await db.sessions.where("state").equals("in_progress").toArray();
  return candidates.find((s) => s.deletedAt === null);
}

async function sessionHasCompletedSets(db: GymDatabase, sessionId: string): Promise<boolean> {
  const sessionExerciseIds = (await db.sessionExercises.where("sessionId").equals(sessionId).toArray()).map((se) => se.id);
  for (const sessionExerciseId of sessionExerciseIds) {
    const sets = await db.sets.where("sessionExerciseId").equals(sessionExerciseId).toArray();
    if (sets.some((s) => s.deletedAt === null && s.completed)) return true;
  }
  return false;
}

async function transitionState(db: GymDatabase, id: string, state: SessionState): Promise<void> {
  const deviceId = await db.getDeviceId();
  return db.transaction("rw", db.sessions, db.syncQueue, async () => {
    await db.sessions.update(id, { state, updatedAt: now(), deviceId, syncedAt: null });
    await enqueueSync(db, "session", id, "upsert");
  });
}

// Bumps the parent session's lastActivityAt on every set write — this is
// what lets crash recovery skip a separate autosave (§6.2). Deliberately
// lightweight: no deviceId/syncedAt stamp, no syncQueue enqueue, since
// this fires on every single set write and is a local crash-recovery
// signal rather than sync-critical content; the session's real content
// changes (state, note, ...) are what actually drive sync.
export async function bumpSessionActivity(db: GymDatabase, sessionId: string, timestamp: number): Promise<void> {
  await db.sessions.update(sessionId, { lastActivityAt: timestamp });
}

export function createSessionRepository(db: GymDatabase): SessionRepository {
  return {
    async create(input) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessions, db.syncQueue, async () => {
        const existingActive = await findActive(db);
        if (existingActive) {
          throw new Error(
            `Cannot start a new session — session ${existingActive.id} is still in_progress. Finish, discard, or resolve it first.`
          );
        }

        const record: SessionRecord = {
          id: newId(),
          state: "in_progress",
          startedAt: input.startedAt,
          endedAt: null,
          tzOffsetMinutes: captureTzOffsetMinutes(input.startedAt),
          note: input.note ?? null,
          routineId: input.routineId ?? null,
          lastActivityAt: input.startedAt,
          updatedAt: now(),
          deletedAt: null,
          deviceId,
          syncedAt: null,
          serverUpdatedAt: null,
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
      return db.transaction("rw", db.sessions, db.sessionExercises, db.sets, db.syncQueue, async () => {
        const session = await db.sessions.get(id);
        if (!session || session.deletedAt !== null) {
          throw new Error(`Cannot finish session ${id} — it does not exist or has been deleted.`);
        }
        const hasCompletedSets = await sessionHasCompletedSets(db, id);
        const state: SessionState = hasCompletedSets ? "completed" : "discarded";
        await db.sessions.update(id, { state, endedAt, lastActivityAt: endedAt, updatedAt: now(), deviceId, syncedAt: null });
        await enqueueSync(db, "session", id, "upsert");
      });
    },

    async discard(id) {
      await transitionState(db, id, "discarded");
    },

    async markAbandoned(id) {
      await transitionState(db, id, "abandoned");
    },

    async resume(id) {
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessions, db.syncQueue, async () => {
        const session = await db.sessions.get(id);
        if (!session || session.deletedAt !== null) {
          throw new Error(`Cannot resume session ${id} — it does not exist or has been deleted.`);
        }
        const otherActive = await findActive(db);
        if (otherActive && otherActive.id !== id) {
          throw new Error(`Cannot resume session ${id} — session ${otherActive.id} is already in_progress.`);
        }

        const updated: SessionRecord = { ...session, state: "in_progress", lastActivityAt: now(), updatedAt: now(), deviceId, syncedAt: null };
        await db.sessions.put(updated);
        await enqueueSync(db, "session", id, "upsert");
        return updated;
      });
    },

    async checkForActiveSession() {
      const active = await findActive(db);
      if (!active) return null;

      const isStale = now() - active.lastActivityAt >= STALE_THRESHOLD_MS;
      if (!isStale) return { session: active, isStale: false };

      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.sessions, db.syncQueue, async () => {
        const updated: SessionRecord = { ...active, state: "abandoned", updatedAt: now(), deviceId, syncedAt: null };
        await db.sessions.put(updated);
        await enqueueSync(db, "session", active.id, "upsert");
        return { session: updated, isStale: true };
      });
    },

    async listRecent(limit, before) {
      const rows = await db.sessions.orderBy("startedAt").reverse().toArray();
      // Discarded sessions never appear in history (§6.2) — everything
      // else (in_progress/completed/abandoned) is a real, visible session.
      return rows
        .filter((s) => s.deletedAt === null && s.state !== "discarded" && (before === undefined || s.startedAt < before))
        .slice(0, limit);
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
