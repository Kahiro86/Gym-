import { exportData } from "./exportImport.js";
import { createDerivedStateRepository } from "./repositories/derivedStateRepository.js";
import { getRecentSyncLog, getSyncQueueDepth, recordSyncAttempt } from "./syncLog.js";
import type { GymDatabase } from "./db.js";
import type { ExportBundle } from "./exportImport.js";
import type { SyncLogRecord } from "./types.js";

// Non-UI functions for a future debug menu (task 16) — "you will use this
// constantly." No React component lives here (out of scope for Layer 2);
// Layer 3 wires these into whatever screen it wants.

export async function rebuildCaches(db: GymDatabase): Promise<void> {
  await createDerivedStateRepository(db).rebuildDerivedState();
}

// Transport is stubbed (Phase 3, §9) — "force sync" can't actually push or
// pull anything yet. Records the attempt honestly, with the current queue
// depth, rather than silently no-oping or throwing into a debug-menu
// click handler.
export async function forceSyncNow(db: GymDatabase): Promise<void> {
  const queueDepth = await getSyncQueueDepth(db);
  await recordSyncAttempt(
    db,
    "push",
    {},
    "failure",
    `Sync transport not implemented yet (Phase 3) — ${queueDepth} mutation(s) queued locally.`
  );
}

export async function dumpDatabase(db: GymDatabase): Promise<ExportBundle> {
  return exportData(db);
}

export interface PersistenceStatus {
  persistenceGranted: boolean;
  // Best-effort — undefined when navigator.storage.estimate() isn't
  // available in this environment (older browsers, some embedded
  // webviews, or a non-browser host like these tests).
  usageBytes?: number;
  quotaBytes?: number;
}

export async function getPersistenceStatus(db: GymDatabase): Promise<PersistenceStatus> {
  const deviceSettings = await db.getOrCreateDeviceSettings();
  const status: PersistenceStatus = { persistenceGranted: deviceSettings.persistenceGranted };

  if (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.estimate === "function") {
    try {
      const estimate = await navigator.storage.estimate();
      status.usageBytes = estimate.usage;
      status.quotaBytes = estimate.quota;
    } catch {
      // Best-effort — leave usage/quota undefined if the call fails.
    }
  }

  return status;
}

export interface DebugSnapshot {
  queueDepth: number;
  recentSyncLog: SyncLogRecord[];
  persistence: PersistenceStatus;
  tableCounts: Record<string, number>;
}

export async function getDebugSnapshot(db: GymDatabase): Promise<DebugSnapshot> {
  const [queueDepth, recentSyncLog, persistence] = await Promise.all([
    getSyncQueueDepth(db),
    getRecentSyncLog(db, 50),
    getPersistenceStatus(db),
  ]);

  const tableCounts: Record<string, number> = {};
  for (const table of db.tables) {
    tableCounts[table.name] = await table.count();
  }

  return { queueDepth, recentSyncLog, persistence, tableCounts };
}

// A full local reset — every table, hard-cleared, not soft-deleted. A
// debug/support operation, not a normal user-facing feature (see the
// backlog's sign-out decision) — irreversible without a prior export.
export async function wipeLocalDatabase(db: GymDatabase): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
}
