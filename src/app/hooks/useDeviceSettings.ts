import { useCallback, useEffect, useMemo, useState } from "react";
import { createDeviceSettingsRepository, type DeviceSettingsPatch } from "../../storage/repositories/deviceSettingsRepository.js";
import { useDatabase } from "../db/context.js";
import type { DeviceSettingsRecord } from "../../storage/types.js";

export interface UseDeviceSettingsResult {
  deviceSettings: DeviceSettingsRecord | null;
  loading: boolean;
  error: Error | null;
  update(patch: DeviceSettingsPatch): Promise<DeviceSettingsRecord>;
  refresh(): Promise<void>;
}

// Device-local settings (theme, reduceMotion, rest-timer UI behavior, …,
// §8's device-local half) — the rest timer (Task 9) reads
// restTimerAutoStart and reduceMotion from here; the settings editor
// (Task 16) will read and write the rest.
export function useDeviceSettings(): UseDeviceSettingsResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createDeviceSettingsRepository(db), [db]);
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDeviceSettings(await repo.get());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = useCallback<UseDeviceSettingsResult["update"]>(
    async (patch) => {
      const updated = await repo.update(patch);
      setDeviceSettings(updated);
      return updated;
    },
    [repo]
  );

  return { deviceSettings, loading, error, update, refresh };
}
