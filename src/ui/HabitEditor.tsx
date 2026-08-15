// Habit editor — create and edit.
//
// Not in the build spec, which describes three read screens and no way to
// make a habit. Loop's own flow is the model: pick the kind of habit
// first, because it changes what the rest of the form asks, then a single
// scrolling form saved from a check in the top bar.
//
// A rendering layer like the others: every rule about what is valid comes
// from Layer 2's validateDraft, and every write goes out through Layer 2.
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../db/index.js";
import {
  emptyDraft, draftFromHabit, validateDraft,
  createHabit, updateHabit, archiveHabit, deleteHabit, listRoutines, canChangeType,
} from "../logic/index.js";
import type { HabitDraft } from "../logic/index.js";
import type { FrequencyType, Habit, HabitType, Routine } from "../db/types.js";
import { ChevronLeftIcon, CheckIcon } from "./icons.js";
import "./HabitEditor.css";

const WEEKDAYS = [
  { value: 0, label: "S" }, { value: 1, label: "M" }, { value: 2, label: "T" },
  { value: 3, label: "W" }, { value: 4, label: "T" }, { value: 5, label: "F" },
  { value: 6, label: "S" },
];

const FREQUENCIES: { value: FrequencyType; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "specific_days", label: "Certain days" },
  { value: "times_per_week", label: "Times a week" },
  { value: "times_per_month", label: "Times a month" },
];

/** The first thing Loop asks, because it decides what the form contains. */
function TypePicker({ onPick, onCancel }: { onPick: (t: HabitType) => void; onCancel: () => void }) {
  return (
    <div className="editor">
      <header className="editor__bar">
        <button type="button" className="editor__icon" onClick={onCancel} aria-label="Back">
          <ChevronLeftIcon />
        </button>
        <span className="editor__title">New habit</span>
      </header>

      <button type="button" className="picker" onClick={() => onPick("boolean")}>
        <span className="picker__name">Yes or no</span>
        <span className="picker__hint">Did you do it? Meditate, take vitamins, no smoking.</span>
      </button>

      <button type="button" className="picker" onClick={() => onPick("numeric")}>
        <span className="picker__name">Measurable</span>
        <span className="picker__hint">How much? Steps walked, pages read, litres of water.</span>
      </button>
    </div>
  );
}

function Field({ label, hint, error, children }: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {/* The reason takes the hint's place rather than stacking under it,
          so a corrected field does not leave the form taller than before. */}
      {error
        ? <span className="field__error">{error}</span>
        : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function HabitEditor({ habit, onDone, onCancel }: {
  /** Absent when creating. */
  habit?: Habit;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = !!habit;
  const [type, setType] = useState<HabitType | null>(habit ? habit.type : null);
  const [draft, setDraft] = useState<HabitDraft | null>(habit ? draftFromHabit(habit) : null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [typeLocked, setTypeLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Problems stay hidden until Save is pressed. Marking a field red
  // before it has been filled in scolds someone for not having finished
  // typing yet.
  const [showProblems, setShowProblems] = useState(false);

  useEffect(() => {
    listRoutines(db).then(setRoutines, () => setRoutines([]));
  }, []);

  useEffect(() => {
    if (!habit) return;
    // Layer 1 refuses a type change once entries exist (§6.3). Better to
    // disable the control and say why than to let it be chosen and then
    // rejected on save.
    canChangeType(db, habit.id).then((can) => setTypeLocked(!can), () => setTypeLocked(true));
  }, [habit]);

  const problems = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const problemFor = useCallback(
    (field: keyof HabitDraft) =>
      (showProblems ? problems.find((p) => p.field === field)?.message : undefined),
    [problems, showProblems],
  );

  const patch = useCallback((changes: Partial<HabitDraft>) => {
    setDraft((d) => (d ? { ...d, ...changes } : d));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setShowProblems(true);
    if (validateDraft(draft).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (habit) await updateHabit(db, habit.id, draft);
      else await createHabit(db, draft);
      onDone();
    } catch (err) {
      // A failed save must say so and keep what was typed, never close
      // the form as though it had worked (non-negotiable #6).
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [draft, habit, onDone]);

  if (!type || !draft) {
    return <TypePicker onPick={(t) => { setType(t); setDraft(emptyDraft(t)); }} onCancel={onCancel} />;
  }

  const numeric = draft.type === "numeric";

  return (
    <div className="editor">
      <header className="editor__bar">
        <button type="button" className="editor__icon" onClick={onCancel} aria-label="Cancel">
          <ChevronLeftIcon />
        </button>
        <span className="editor__title">{editing ? draft.name || "Habit" : "New habit"}</span>
        <button
          type="button"
          className="editor__icon editor__icon--save"
          onClick={save}
          disabled={saving}
          aria-label="Save habit"
        >
          <CheckIcon />
        </button>
      </header>

      <div className="editor__form">
        <Field label="Name" error={problemFor("name")}>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Meditate"
            autoFocus={!editing}
          />
        </Field>

        <Field
          label="Question"
          hint="Asked on the detail screen. Leave it blank to skip it."
        >
          <input
            className="input"
            value={draft.question}
            onChange={(e) => patch({ question: e.target.value })}
            placeholder="Did you meditate today?"
          />
        </Field>

        {/* Only when editing: creating already asked, on the picker. */}
        {editing && (
          <Field
            label="Kind"
            hint={typeLocked
              ? "Locked — this habit has logged days, and the values already recorded would mean something different under the other kind. Archive it and make a new one instead."
              : undefined}
          >
            <div className="segmented" role="group" aria-label="Kind of habit">
              <button
                type="button" className="segmented__option"
                aria-pressed={draft.type === "boolean"}
                disabled={typeLocked}
                onClick={() => patch({ type: "boolean" })}
              >
                Yes or no
              </button>
              <button
                type="button" className="segmented__option"
                aria-pressed={draft.type === "numeric"}
                disabled={typeLocked}
                onClick={() => patch({ type: "numeric" })}
              >
                Measurable
              </button>
            </div>
          </Field>
        )}

        {numeric && (
          <>
            <Field label="Target" error={problemFor("target")}>
              <div className="row">
                <input
                  className="input input--short"
                  inputMode="decimal"
                  value={draft.target}
                  onChange={(e) => patch({ target: e.target.value })}
                  placeholder="2"
                />
                <input
                  className="input input--short"
                  value={draft.unit}
                  onChange={(e) => patch({ unit: e.target.value })}
                  placeholder="litres"
                  aria-label="Unit"
                />
              </div>
            </Field>

            <Field label="Counts as done when the value is">
              <div className="segmented" role="group" aria-label="Target direction">
                <button
                  type="button" className="segmented__option"
                  aria-pressed={draft.targetDirection === "at_least"}
                  onClick={() => patch({ targetDirection: "at_least" })}
                >
                  at least the target
                </button>
                <button
                  type="button" className="segmented__option"
                  aria-pressed={draft.targetDirection === "at_most"}
                  onClick={() => patch({ targetDirection: "at_most" })}
                >
                  at most the target
                </button>
              </div>
            </Field>
          </>
        )}

        <Field
          label="How often"
          error={problemFor("frequencyDays") ?? problemFor("frequencyCount")}
        >
          <select
            className="input"
            value={draft.frequencyType}
            onChange={(e) => patch({ frequencyType: e.target.value as FrequencyType })}
          >
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>

        {draft.frequencyType === "specific_days" && (
          <div className="days" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((d, i) => {
              const on = draft.frequencyDays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  className="days__day"
                  aria-pressed={on}
                  // Two Tuesdays and two Saturdays share a letter, so the
                  // spoken label carries the real name.
                  aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                  onClick={() => patch({
                    frequencyDays: on
                      ? draft.frequencyDays.filter((x) => x !== d.value)
                      : [...draft.frequencyDays, d.value],
                  })}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        )}

        {(draft.frequencyType === "times_per_week" || draft.frequencyType === "times_per_month") && (
          <Field label={draft.frequencyType === "times_per_week" ? "Times a week" : "Times a month"}>
            <input
              className="input input--short"
              inputMode="numeric"
              value={draft.frequencyCount}
              onChange={(e) => patch({ frequencyCount: e.target.value })}
            />
          </Field>
        )}

        <Field label="Group" hint={routines.length ? undefined : "Groups appear here once you have one."}>
          <select
            className="input"
            value={draft.routineId ?? ""}
            onChange={(e) => patch({ routineId: e.target.value || null })}
          >
            <option value="">No group</option>
            {routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>

        <Field label="Reminder" hint="24-hour, e.g. 07:30." error={problemFor("reminderTime")}>
          <input
            className="input input--short"
            value={draft.reminderTime}
            onChange={(e) => patch({ reminderTime: e.target.value })}
            placeholder="07:30"
          />
        </Field>

        {saveError && (
          <div className="editor__error" role="alert">
            <div className="editor__error-title">That did not save</div>
            <div className="editor__error-detail">{saveError}</div>
          </div>
        )}

        {editing && (
          <div className="editor__danger">
            <button
              type="button"
              className="editor__secondary"
              onClick={async () => { await archiveHabit(db, habit.id); onDone(); }}
            >
              Archive — hides it, keeps every logged day
            </button>

            {confirmingDelete ? (
              <div className="editor__confirm" role="alert">
                <div className="editor__confirm-text">
                  Delete {draft.name || "this habit"} and every day logged against it?
                  This cannot be undone.
                </div>
                <div className="row">
                  <button type="button" className="editor__secondary" onClick={() => setConfirmingDelete(false)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="editor__destructive"
                    onClick={async () => { await deleteHabit(db, habit.id); onDone(); }}
                  >
                    Delete for good
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="editor__destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete permanently
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
