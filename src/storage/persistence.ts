import { createDeviceSettingsRepository } from "./repositories/deviceSettingsRepository.js";
import type { GymDatabase } from "./db.js";

// §2.6: IndexedDB is evictable — iOS Safari clears it after roughly seven
// days of non-use unless the PWA is installed to the home screen, and any
// browser may evict under storage pressure. With no sync in v1, eviction
// means losing a user's entire training history. This module is the
// concrete behavior the spec calls for; Layer 3 owns the actual prompt UI.

// Call at the first meaningful write (first set logged) — the persistence
// prompt converts far better once the user has something to lose than at
// a blank app-start screen. Idempotent per device: only ever actually
// calls navigator.storage.persist() once, tracked via
// deviceSettings.persistenceRequested, regardless of the outcome — the
// outcome itself is recorded separately (persistenceGranted) so the
// debug menu (task 16) can show it.
export async function ensurePersistenceRequested(db: GymDatabase): Promise<void> {
  const deviceSettings = await db.getOrCreateDeviceSettings();
  if (deviceSettings.persistenceRequested) return;

  let granted = false;
  if (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.persist === "function") {
    try {
      granted = await navigator.storage.persist();
    } catch {
      granted = false;
    }
  }

  await createDeviceSettingsRepository(db).update({ persistenceRequested: true, persistenceGranted: granted });
}

export interface StorageEstimateInfo {
  usageBytes: number;
  quotaBytes: number;
  usageRatio: number; // 0-1
}

// Check on startup — best-effort, undefined wherever navigator.storage
// isn't available (older browsers, some embedded webviews, non-browser
// hosts like these tests).
export async function checkStorageEstimate(): Promise<StorageEstimateInfo | undefined> {
  if (typeof navigator === "undefined" || !navigator.storage || typeof navigator.storage.estimate !== "function") {
    return undefined;
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage === undefined || quota === undefined || quota === 0) return undefined;
    return { usageBytes: usage, quotaBytes: quota, usageRatio: usage / quota };
  } catch {
    return undefined;
  }
}

// "If usage is approaching quota, surface it" — the threshold below is
// this module's own judgment call on what "approaching" means.
const USAGE_WARNING_THRESHOLD = 0.8;

export function isApproachingQuota(estimate: StorageEstimateInfo): boolean {
  return estimate.usageRatio >= USAGE_WARNING_THRESHOLD;
}

// "Treat 'install to home screen' as a data-safety prompt ... show it
// after the first completed session." A pure decision function — Layer 3
// owns the actual prompt UI and its own dismissal/snooze state; this only
// answers whether the trigger condition (at least one completed session)
// has fired.
export async function shouldPromptInstallToHomeScreen(db: GymDatabase): Promise<boolean> {
  const completedCount = await db.sessions.where("state").equals("completed").count();
  return completedCount > 0;
}
