import { newId, now } from "./ids.js";
import type { GymDatabase } from "./db.js";
import type { SyncEntityType, SyncOperation, SyncQueueRecord } from "./types.js";

// Must be called from *inside* the same Dexie transaction as the write it
// describes (include db.syncQueue in the transaction's table list) — a
// non-atomic enqueue can lose mutations (spec §5 rules, §7.2).
export async function enqueueSync(db: GymDatabase, entityType: SyncEntityType, entityId: string, operation: SyncOperation): Promise<void> {
  const record: SyncQueueRecord = {
    id: newId(),
    entityType,
    entityId,
    operation,
    createdAt: now(),
    attempts: 0,
  };
  await db.syncQueue.add(record);
}
