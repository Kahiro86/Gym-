import { useProfile } from "../hooks/useProfile.js";
import { Stepper } from "../ui/Stepper.js";
import { Button } from "../ui/Button.js";
import styles from "./ProfileSection.module.css";
import type { Sex } from "../../storage/types.js";

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "unspecified", label: "Prefer not to say" },
];

const DEFAULT_HEIGHT_CM = 170;

// The synced profile fields (spec §14 task 16) — height, birth date, sex.
// None of these feed the XP engine directly (only bodyweight, logged per
// set, does that); they're informational/account-level only.
export function ProfileSection() {
  const { profile, update } = useProfile();

  if (!profile) return null;

  return (
    <section>
      <h2 className={styles.heading}>Profile</h2>

      <div className={styles.row}>
        <span className={styles.label}>Height</span>
        <Stepper
          value={profile.heightCm ?? DEFAULT_HEIGHT_CM}
          step={1}
          min={100}
          max={250}
          editable
          inputMode="numeric"
          formatValue={(v) => `${v} cm`}
          label="Height"
          onChange={(next) => update({ heightCm: next })}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Birth date</span>
        <input
          className={styles.dateInput}
          type="date"
          value={profile.birthDate ?? ""}
          onChange={(event) => update({ birthDate: event.target.value || null })}
          aria-label="Birth date"
        />
      </div>

      <span className={styles.label}>Sex</span>
      <div className={styles.sexGroup} role="group" aria-label="Sex">
        {SEX_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="compact"
            variant={profile.sex === option.value ? "primary" : "secondary"}
            onClick={() => update({ sex: option.value })}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
