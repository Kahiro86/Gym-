import { newId, now } from "./ids.js";
import type { GymDatabase } from "./db.js";
import type { SyncDirection, SyncEntityType, SyncLogRecord, SyncOutcome } from "./types.js";

// §9.6: a rolling record of the last MAX_ENTRIES sync attempts, surfaced
// in the debug menu (task 16) — the only evidence available when sync
// breaks in the wild. Transport (the actual push/pull drain loop) stays
// stubbed per spec §9/§15 — this is the schema and the recording
// primitive a future transport calls into, not the transport itself.
const MAX_ENTRIES = 200;

export async function recordSyncAttempt(
  db: GymDatabase,
  direction: SyncDirection,
  entityCounts: Partial<Record<SyncEntityType, number>>,
  outcome: SyncOutcome,
  error: string | null = null
): Promise<void> {
  const record: SyncLogRecord = { id: newId(), timestamp: now(), direction, entityCounts, outcome, error };

  await db.transaction("rw", db.syncLog, async () => {
    await db.syncLog.add(record);

    const total = await db.syncLog.count();
    if (total > MAX_ENTRIES) {
      const oldest = await db.syncLog.orderBy("timestamp").limit(total - MAX_ENTRIES).toArray();
      await db.syncLog.bulkDelete(oldest.map((r) => r.id));
    }
  });
}

export async function getRecentSyncLog(db: GymDatabase, limit: number = MAX_ENTRIES): Promise<SyncLogRecord[]> {
  const rows = await db.syncLog.orderBy("timestamp").reverse().toArray();
  return rows.slice(0, limit);
}

export async function getSyncQueueDepth(db: GymDatabase): Promise<number> {
  return db.syncQueue.count();
}
