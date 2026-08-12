import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  disabled?: boolean;
}

// A labeled on/off switch (design system primitive, spec §14 task 3/16) —
// role="switch" rather than a checkbox input, since this always renders as
// a full-width row with its own visible label, not a form checkbox next
// to separate label text.
export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={styles.row}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.label}>{label}</span>
      <span className={`${styles.track} ${checked ? styles.on : ""}`}>
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
