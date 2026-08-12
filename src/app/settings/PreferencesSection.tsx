import { useDeviceSettings } from "../hooks/useDeviceSettings.js";
import { Toggle } from "../ui/Toggle.js";
import styles from "./PreferencesSection.module.css";

// Device-local toggles the rest timer (Task 9) already reads —
// restTimerAutoStart and reduceMotion — surfaced for editing here (spec
// §14 task 16). No optimistic UI (§2): each toggle awaits its own
// update() before the switch itself reflects the new state.
export function PreferencesSection() {
  const { deviceSettings, update } = useDeviceSettings();

  if (!deviceSettings) return null;

  return (
    <section>
      <h2 className={styles.heading}>Preferences</h2>
      <div className={styles.list}>
        <Toggle
          label="Auto-start rest timer"
          checked={deviceSettings.restTimerAutoStart}
          onChange={(next) => update({ restTimerAutoStart: next })}
        />
        <Toggle label="Reduce motion" checked={deviceSettings.reduceMotion} onChange={(next) => update({ reduceMotion: next })} />
      </div>
    </section>
  );
}
