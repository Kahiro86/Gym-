import { now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import type { GymDatabase } from "../db.js";
import type { SettingsRecord, Theme, Units } from "../types.js";

export interface SettingsPatch {
  units?: Units;
  weeklyTargetSessions?: number | null;
  theme?: Theme;
}

export interface SettingsRepository {
  get(): Promise<SettingsRecord>;
  update(patch: SettingsPatch): Promise<SettingsRecord>;
}

export function createSettingsRepository(db: GymDatabase): SettingsRepository {
  return {
    async get() {
      return db.getOrCreateSettings();
    },

    async update(patch) {
      return db.transaction("rw", db.settings, db.syncQueue, async () => {
        const current = await db.getOrCreateSettings();
        const deviceId = await db.getDeviceId();

        const updated: SettingsRecord = {
          ...current,
          ...patch,
          updatedAt: now(),
          deviceId,
          syncedAt: null,
        };

        await db.settings.put(updated);
        await enqueueSync(db, "settings", updated.id, "upsert");
        return updated;
      });
    },
  };
}
