import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Stepper.module.css";

export interface StepperProps {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange(next: number): void;
  formatValue?(value: number): string;
  label?: string;
  disabled?: boolean;
  // Lets the displayed value be tapped and typed directly via the OS
  // numeric keyboard (spec §2: inputMode="decimal"/"numeric" for numeric
  // fields) — for jumping straight to e.g. 102.5kg instead of many taps.
  editable?: boolean;
  inputMode?: "decimal" | "numeric";
}

const HOLD_REPEAT_DELAY_MS = 400;
const HOLD_REPEAT_INTERVAL_MS = 90;

// Every button is >=56px square (spec §2). A tap applies one step via
// onClick, which fires on release regardless of press duration; holding
// past HOLD_REPEAT_DELAY_MS layers repeated applies on top via
// onMouseDown/onMouseUp, so a quick tap only ever moves once.
export function Stepper({
  value,
  step = 1,
  min = -Infinity,
  max = Infinity,
  onChange,
  formatValue,
  label,
  disabled = false,
  editable = false,
  inputMode = "decimal",
}: StepperProps) {
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const valueRef = useRef(value);
  valueRef.current = value;

  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max]);
  const apply = useCallback((delta: number) => onChange(clamp(valueRef.current + delta)), [clamp, onChange]);

  const stopHold = useCallback(() => {
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimeout.current = undefined;
    holdInterval.current = undefined;
  }, []);

  const armHold = useCallback(
    (delta: number) => {
      stopHold();
      holdTimeout.current = setTimeout(() => {
        holdInterval.current = setInterval(() => apply(delta), HOLD_REPEAT_INTERVAL_MS);
      }, HOLD_REPEAT_DELAY_MS);
    },
    [apply, stopHold]
  );

  useEffect(() => stopHold, [stopHold]);

  const display = formatValue ? formatValue(value) : String(value);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  function commitDraft() {
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed)) {
      onChange(clamp(parsed));
    } else {
      setDraft(String(value));
    }
    setEditing(false);
  }

  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.button}
        disabled={disabled || value <= min}
        aria-label={label ? `Decrease ${label}` : "Decrease"}
        onClick={() => apply(-step)}
        onMouseDown={() => armHold(-step)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
      >
        −
      </button>

      {editable && editing ? (
        <input
          className={styles.input}
          type="text"
          inputMode={inputMode}
          value={draft}
          autoFocus
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(String(value));
              setEditing(false);
            }
          }}
        />
      ) : editable ? (
        <button type="button" className={styles.value} onClick={() => setEditing(true)} disabled={disabled} aria-label={label ? `Edit ${label}` : "Edit value"}>
          {display}
        </button>
      ) : (
        <span className={styles.value}>{display}</span>
      )}

      <button
        type="button"
        className={styles.button}
        disabled={disabled || value >= max}
        aria-label={label ? `Increase ${label}` : "Increase"}
        onClick={() => apply(step)}
        onMouseDown={() => armHold(step)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
      >
        +
      </button>
    </div>
  );
}
