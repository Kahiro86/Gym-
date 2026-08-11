import { now } from "../ids.js";
import type { GymDatabase } from "../db.js";
import type { DeviceSettingsRecord, Theme } from "../types.js";

export interface DeviceSettingsPatch {
  theme?: Theme;
  reduceMotion?: boolean;
  soundEnabled?: boolean;
  restTimerAutoStart?: boolean;
  restTimerSoundEnabled?: boolean;
  persistenceRequested?: boolean;
  persistenceGranted?: boolean;
  onboardingCompleted?: boolean;
}

export interface DeviceSettingsRepository {
  get(): Promise<DeviceSettingsRecord>;
  update(patch: DeviceSettingsPatch): Promise<DeviceSettingsRecord>;
}

// The device-local half of §8's settings split — never carries sync
// columns and never enqueues to syncQueue, because it never leaves the
// device. Theme, motion/sound preferences, rest-timer UI behavior, and
// the persistence-granted flag (§2.6) all live here, not in settings.
export function createDeviceSettingsRepository(db: GymDatabase): DeviceSettingsRepository {
  return {
    async get() {
      return db.getOrCreateDeviceSettings();
    },

    async update(patch) {
      return db.transaction("rw", db.deviceSettings, async () => {
        const current = await db.getOrCreateDeviceSettings();
        const updated: DeviceSettingsRecord = { ...current, ...patch, updatedAt: now() };
        await db.deviceSettings.put(updated);
        return updated;
      });
    },
  };
}
