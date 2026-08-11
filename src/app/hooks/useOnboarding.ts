import { useCallback, useEffect, useMemo, useState } from "react";
import { createDeviceSettingsRepository } from "../../storage/repositories/deviceSettingsRepository.js";
import { useDatabase } from "../db/context.js";

export interface UseOnboardingResult {
  loading: boolean;
  completed: boolean;
  complete(): Promise<void>;
}

// Gates the onboarding flow (Task 4) on deviceSettings.onboardingCompleted
// — device-local, so a fresh browser profile on an already-synced account
// still sees onboarding once, same reasoning as persistenceRequested.
export function useOnboarding(): UseOnboardingResult {
  const { db } = useDatabase();
  const repo = useMemo(() => createDeviceSettingsRepository(db), [db]);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo.get().then((settings) => {
      if (cancelled) return;
      setCompleted(settings.onboardingCompleted);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const complete = useCallback(async () => {
    await repo.update({ onboardingCompleted: true });
    setCompleted(true);
  }, [repo]);

  return { loading, completed, complete };
}
