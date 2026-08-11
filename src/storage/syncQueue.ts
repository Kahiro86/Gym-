import { newId, now } from "./ids.js";
import type { GymDatabase } from "./db.js";
import type { SyncEntityType, SyncOperation, SyncQueueRecord } from "./types.js";

// Must be called from *inside* the same Dexie transaction as the write it
// describes (include db.syncQueue in the transaction's table list) — a
// non-atomic enqueue can lose mutations (spec §6 rules, §9.4).
//
// mutationId (§9.3) is the idempotency key a real transport will dedupe
// on — generated fresh per enqueue, distinct from `id` (this queue row's
// own identity). The drain loop and syncLog land in task 15; this is the
// enqueue mechanism every write-path repository has needed since.
export async function enqueueSync(db: GymDatabase, entityType: SyncEntityType, entityId: string, operation: SyncOperation): Promise<void> {
  const record: SyncQueueRecord = {
    id: newId(),
    mutationId: newId(),
    entityType,
    entityId,
    operation,
    createdAt: now(),
    attempts: 0,
  };
  await db.syncQueue.add(record);
}
