import { now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import type { GymDatabase } from "../db.js";
import type { SettingsRecord, Units } from "../types.js";

export interface SettingsPatch {
  units?: Units;
  weeklyTargetSessions?: number | null;
  defaultRestSeconds?: number;
}

export interface SettingsRepository {
  get(): Promise<SettingsRecord>;
  update(patch: SettingsPatch): Promise<SettingsRecord>;
}

// The synced half of §8's settings split — training preferences that
// should follow the user across devices. See deviceSettingsRepository.ts
// for the device-local half.
export function createSettingsRepository(db: GymDatabase): SettingsRepository {
  return {
    async get() {
      return db.getOrCreateSettings();
    },

    async update(patch) {
      // getOrCreateSettings()/getDeviceId() both only need db.settings,
      // which this transaction already includes — safe to call inside.
      return db.transaction("rw", db.settings, db.syncQueue, async () => {
        const current = await db.getOrCreateSettings();
        const deviceId = await db.getDeviceId();
        const updated: SettingsRecord = { ...current, ...patch, updatedAt: now(), deviceId, syncedAt: null };
        await db.settings.put(updated);
        await enqueueSync(db, "settings", updated.id, "upsert");
        return updated;
      });
    },
  };
}
