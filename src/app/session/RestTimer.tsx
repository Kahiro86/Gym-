import { useEffect, useRef } from "react";
import { useActiveSessionStore } from "../store/activeSessionStore.js";
import { useRestRemaining } from "../hooks/useRestRemaining.js";
import { useDeviceSettings } from "../hooks/useDeviceSettings.js";
import { triggerHaptic } from "./haptics.js";
import { Button } from "../ui/Button.js";
import styles from "./RestTimer.module.css";

const ADD_SECONDS_STEP = 15;

// The rest countdown (spec §14 task 9) — renders nothing while no rest is
// running. Fires one haptic pulse the moment remaining time hits zero,
// gated on deviceSettings.reduceMotion (spec: haptics respect
// prefers-reduced-motion) rather than the OS media query, since the app
// already models this as an explicit per-device setting (§8).
export function RestTimer() {
  const restStartedAt = useActiveSessionStore((s) => s.restStartedAt);
  const addRestSeconds = useActiveSessionStore((s) => s.addRestSeconds);
  const stopRest = useActiveSessionStore((s) => s.stopRest);
  const remaining = useRestRemaining();
  const { deviceSettings, loading: deviceSettingsLoading } = useDeviceSettings();
  const firedRef = useRef(false);

  useEffect(() => {
    if (restStartedAt === null) {
      firedRef.current = false;
      return;
    }
    // Wait for deviceSettings to actually resolve before deciding —
    // otherwise a rest that's already at 0 the instant this mounts (e.g.
    // restored from the store on remount) could fire before reduceMotion
    // is known, defaulting to "on" and firing a haptic reduceMotion
    // should have suppressed.
    if (remaining === 0 && !firedRef.current && !deviceSettingsLoading) {
      firedRef.current = true;
      if (!deviceSettings?.reduceMotion) triggerHaptic();
    }
  }, [remaining, restStartedAt, deviceSettings, deviceSettingsLoading]);

  if (restStartedAt === null || remaining === null) return null;

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className={styles.timer} role="timer" aria-label="Rest timer">
      <span className={styles.time}>
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>
      <div className={styles.actions}>
        <Button size="compact" variant="secondary" onClick={() => addRestSeconds(ADD_SECONDS_STEP)}>
          +{ADD_SECONDS_STEP}s
        </Button>
        <Button size="compact" variant="ghost" className={styles.skipButton} onClick={stopRest}>
          Skip
        </Button>
      </div>
    </div>
  );
}
