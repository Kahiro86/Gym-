import { useState } from "react";
import { useExercise } from "../hooks/useExercise.js";
import { useCurrentBodyweight } from "../hooks/useCurrentBodyweight.js";
import { useDeviceSettings } from "../hooks/useDeviceSettings.js";
import { useActiveSessionStore } from "../store/activeSessionStore.js";
import { Stepper } from "../ui/Stepper.js";
import { Button } from "../ui/Button.js";
import styles from "./LogSetForm.module.css";
import type { LoadType } from "../../domain/types.js";
import type { NewSet } from "../../storage/repositories/setRepository.js";
import type { SetRecord } from "../../storage/types.js";

export interface LogSetFormProps {
  sessionExerciseId: string;
  exerciseId: string;
  defaultReps?: number;
  defaultWeightKg?: number;
  // Passed down from the same useSets() instance SetList reads, rather
  // than calling useSets() again here — two independent hook instances
  // for the same sessionExerciseId don't see each other's writes, so a
  // logged set would never show up in the list next to this form.
  log(input: NewSet): Promise<SetRecord>;
  onLogged?(): void;
}

type InputMode = "weight_reps" | "reps_only" | "duration" | "distance";

function inputModeFor(loadType: LoadType): InputMode {
  switch (loadType) {
    case "bodyweight":
      return "reps_only";
    case "time":
      return "duration";
    case "distance":
      return "distance";
    default:
      // barbell/machine/dumbbell/cable take a lifted weight; for
      // weighted_bodyweight/assisted this is added weight/assistance —
      // still a plain weightKg column either way (§5, Layer 1 interprets
      // the sign via loadType, not this form).
      return "weight_reps";
  }
}

const DEFAULT_WEIGHT_KG = 20;
const DEFAULT_REPS = 8;
const DEFAULT_DURATION_SEC = 30;
const DEFAULT_DISTANCE_M = 100;

// The set-logging inputs (spec §14 task 6): steppers sized as >=56px tap
// targets, each editable via a tap-to-type numeric field for large jumps
// (spec §2: inputMode="decimal"/"numeric"). Branches on the exercise's
// loadType so a bodyweight movement never asks for a weight it doesn't
// take, and stamps bodyweightKgAtTime from the user's last known weigh-in
// automatically (useCurrentBodyweight) rather than asking again per set.
export function LogSetForm({ sessionExerciseId, exerciseId, defaultReps, defaultWeightKg, log, onLogged }: LogSetFormProps) {
  const { exercise, loading: exerciseLoading } = useExercise(exerciseId);
  const { bodyweightKg } = useCurrentBodyweight();
  const { deviceSettings } = useDeviceSettings();
  const startRest = useActiveSessionStore((s) => s.startRest);

  const [weightKg, setWeightKg] = useState(defaultWeightKg ?? DEFAULT_WEIGHT_KG);
  const [reps, setReps] = useState(defaultReps ?? DEFAULT_REPS);
  const [durationSec, setDurationSec] = useState(DEFAULT_DURATION_SEC);
  const [distanceM, setDistanceM] = useState(DEFAULT_DISTANCE_M);
  const [isWarmup, setIsWarmup] = useState(false);
  const [saving, setSaving] = useState(false);

  if (exerciseLoading || !exercise) return null;

  const mode = inputModeFor(exercise.loadType);
  const resolvedExercise = exercise;

  async function handleLog() {
    setSaving(true);
    try {
      await log({
        sessionExerciseId,
        weightKg: mode === "weight_reps" ? weightKg : null,
        reps: mode === "weight_reps" || mode === "reps_only" ? reps : null,
        durationSec: mode === "duration" ? durationSec : null,
        distanceM: mode === "distance" ? distanceM : null,
        isWarmup,
        bodyweightKgAtTime: bodyweightKg,
        loggedAt: Date.now(),
      });
      // Rest follows a real working set, never a warmup (spec §14 task 9),
      // and only when the device has auto-start enabled (§8 default: on).
      if (!isWarmup && deviceSettings?.restTimerAutoStart) {
        startRest(resolvedExercise.defaultRestSeconds);
      }
      setIsWarmup(false);
      onLogged?.();
    } catch (err) {
      // Task 18 owns real error-surfacing UI (e.g. storage evicted
      // mid-write) — for now, just don't leave this unhandled.
      console.error("Failed to log set", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.steppers}>
        {mode === "weight_reps" && (
          <Stepper
            value={weightKg}
            step={2.5}
            min={0}
            max={500}
            onChange={setWeightKg}
            formatValue={(v) => `${v} kg`}
            label="Weight"
            editable
          />
        )}
        {(mode === "weight_reps" || mode === "reps_only") && (
          <Stepper value={reps} step={1} min={1} max={200} onChange={setReps} label="Reps" editable inputMode="numeric" />
        )}
        {mode === "duration" && (
          <Stepper
            value={durationSec}
            step={5}
            min={1}
            max={86_400}
            onChange={setDurationSec}
            formatValue={(v) => `${v}s`}
            label="Duration"
            editable
            inputMode="numeric"
          />
        )}
        {mode === "distance" && (
          <Stepper
            value={distanceM}
            step={50}
            min={1}
            onChange={setDistanceM}
            formatValue={(v) => `${v} m`}
            label="Distance"
            editable
            inputMode="numeric"
          />
        )}
      </div>

      <label className={styles.warmupToggle}>
        <input type="checkbox" checked={isWarmup} onChange={(event) => setIsWarmup(event.target.checked)} />
        Warmup set
      </label>

      <Button className={styles.logButton} onClick={handleLog} disabled={saving}>
        Log set
      </Button>
    </div>
  );
}
