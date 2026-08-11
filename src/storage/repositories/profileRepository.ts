import { now } from "../ids.js";
import { enqueueSync } from "../syncQueue.js";
import type { GymDatabase } from "../db.js";
import type { ProfileRecord, Sex } from "../types.js";

export interface ProfilePatch {
  heightCm?: number | null;
  birthDate?: string | null;
  sex?: Sex | null;
}

export interface ProfileRepository {
  get(): Promise<ProfileRecord>;
  update(patch: ProfilePatch): Promise<ProfileRecord>;
}

export function createProfileRepository(db: GymDatabase): ProfileRepository {
  return {
    async get() {
      return db.getOrCreateProfile();
    },

    async update(patch) {
      // Resolved before opening the transaction: getDeviceId() needs
      // db.settings, which this transaction's table set ({profile,
      // syncQueue}) doesn't include — Dexie requires a sub-transaction's
      // tables to be a subset of its parent's.
      const deviceId = await db.getDeviceId();
      return db.transaction("rw", db.profile, db.syncQueue, async () => {
        const current = await db.getOrCreateProfile();
        const updated: ProfileRecord = { ...current, ...patch, updatedAt: now(), deviceId, syncedAt: null };
        await db.profile.put(updated);
        await enqueueSync(db, "profile", updated.id, "upsert");
        return updated;
      });
    },
  };
}
