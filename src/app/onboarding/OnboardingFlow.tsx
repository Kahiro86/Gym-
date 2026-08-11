import { useState } from "react";
import { createSettingsRepository } from "../../storage/repositories/settingsRepository.js";
import { createBodyweightRepository } from "../../storage/repositories/bodyweightRepository.js";
import { useDatabase } from "../db/context.js";
import { Button } from "../ui/Button.js";
import { Stepper } from "../ui/Stepper.js";
import styles from "./OnboardingFlow.module.css";
import type { Units } from "../../storage/types.js";

export interface OnboardingFlowProps {
  // Called once the flow's own writes (settings, bodyweight) have
  // committed — the caller (useOnboarding) owns flipping
  // deviceSettings.onboardingCompleted, so there is exactly one place
  // that does it whether the user finished or skipped.
  onDone(): Promise<void>;
}

type Step = "units" | "bodyweight" | "target";
const STEPS: Step[] = ["units", "bodyweight", "target"];

const DEFAULT_BODYWEIGHT_KG = 70;
const DEFAULT_WEEKLY_TARGET = 3;

// Three questions (spec §14 task 4), each with a sane default already
// selected — Next never blocks on an answer. Bodyweight is always
// captured/stored in kg regardless of the chosen display units; per-unit
// display formatting elsewhere in the app is a later concern (storage
// stays canonically kg, per validateBodyweightKg).
export function OnboardingFlow({ onDone }: OnboardingFlowProps) {
  const { db } = useDatabase();
  const [stepIndex, setStepIndex] = useState(0);
  const [units, setUnits] = useState<Units>("kg");
  const [bodyweightKg, setBodyweightKg] = useState(DEFAULT_BODYWEIGHT_KG);
  const [weeklyTarget, setWeeklyTarget] = useState(DEFAULT_WEEKLY_TARGET);
  const [saving, setSaving] = useState(false);

  const step = STEPS[stepIndex]!;
  const isLast = stepIndex === STEPS.length - 1;

  async function persist(finalWeeklyTarget: number | null, finalBodyweightKg: number | null) {
    setSaving(true);
    try {
      await createSettingsRepository(db).update({ units, weeklyTargetSessions: finalWeeklyTarget });
      if (finalBodyweightKg !== null) {
        await createBodyweightRepository(db).log({ bodyweightKg: finalBodyweightKg, recordedAt: Date.now() });
      }
      await onDone();
    } catch (err) {
      // Task 18 owns real error-surfacing UI — for now, just don't leave
      // this unhandled.
      console.error("Failed to complete onboarding", err);
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    if (isLast) {
      persist(weeklyTarget, bodyweightKg);
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  function handleSkip() {
    persist(null, null);
  }

  return (
    <div className={styles.flow}>
      <button type="button" className={styles.skip} onClick={handleSkip} disabled={saving}>
        Skip
      </button>

      <div className={styles.content}>
        {step === "units" && (
          <section>
            <h1 className={styles.question}>Which units do you train in?</h1>
            <div className={styles.choices}>
              <Button variant={units === "kg" ? "primary" : "secondary"} onClick={() => setUnits("kg")}>
                Kilograms
              </Button>
              <Button variant={units === "lb" ? "primary" : "secondary"} onClick={() => setUnits("lb")}>
                Pounds
              </Button>
            </div>
          </section>
        )}

        {step === "bodyweight" && (
          <section>
            <h1 className={styles.question}>What&rsquo;s your current bodyweight?</h1>
            <Stepper
              value={bodyweightKg}
              step={0.5}
              min={20}
              max={300}
              onChange={setBodyweightKg}
              formatValue={(v) => `${v} kg`}
              label="Bodyweight"
            />
          </section>
        )}

        {step === "target" && (
          <section>
            <h1 className={styles.question}>How many sessions a week are you aiming for?</h1>
            <Stepper value={weeklyTarget} step={1} min={1} max={7} onChange={setWeeklyTarget} label="Weekly target" />
          </section>
        )}
      </div>

      <Button className={styles.next} onClick={handleNext} disabled={saving}>
        {isLast ? "Finish" : "Next"}
      </Button>
    </div>
  );
}
