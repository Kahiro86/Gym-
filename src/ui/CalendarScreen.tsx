// Screen 3 — calendar, best streaks, frequency.
import { useCallback, useState } from "react";
import { db } from "../db/index.js";
import {
  getCalendarMonth, getStreaksView, describeDay, stepMonth, toggleEntry, setEntry, deleteEntry,
  WEEK_DOT_LABELS,
} from "../logic/index.js";
import type { CalendarDay, CalendarMonth, StreaksView } from "../logic/index.js";
import type { Habit } from "../db/types.js";
import { useAsync } from "./useAsync.js";
import { ChevronLeftIcon, ChevronRightIcon, EditIcon } from "./icons.js";
import "./CalendarScreen.css";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function prettyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
}

type CalendarView = CalendarMonth & { habit: Habit };

/** The popover a tapped cell opens. It never navigates away. */
function DayPopover({ habit, day, editing, onWrite, onClose, busy }: {
  habit: Habit;
  day: CalendarDay;
  editing: boolean;
  onWrite: (action: "toggle" | "clear" | { value: number }) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<string>(day.value === null ? "" : String(day.value));

  return (
    <div className="popover" role="dialog" aria-label={`${prettyDate(day.date)} detail`}>
      <div className="popover__head">
        <span className="popover__date">{prettyDate(day.date)}</span>
        <span className="popover__value">{describeDay(habit, day)}</span>
      </div>

      {editing && !day.inFuture && (
        <div className="popover__actions">
          {habit.type === "boolean" ? (
            <>
              <button type="button" className="popover__action popover__action--primary"
                disabled={busy} onClick={() => onWrite("toggle")}>
                Cycle done / missed / clear
              </button>
              {day.value !== null && (
                <button type="button" className="popover__action popover__action--danger"
                  disabled={busy} onClick={() => onWrite("clear")}>
                  Clear
                </button>
              )}
            </>
          ) : (
            <>
              <input
                className="popover__number"
                type="number"
                inputMode="decimal"
                value={draft}
                aria-label={`Value for ${prettyDate(day.date)}`}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="button" className="popover__action popover__action--primary"
                disabled={busy || draft.trim() === "" || Number.isNaN(Number(draft))}
                onClick={() => onWrite({ value: Number(draft) })}>
                Save
              </button>
              {day.value !== null && (
                <button type="button" className="popover__action popover__action--danger"
                  disabled={busy} onClick={() => onWrite("clear")}>
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="popover__actions">
        <button type="button" className="popover__action" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function CalendarScreen({ habitId, onBack }: { habitId: string; onBack: () => void }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<Error | null>(null);

  const calendar = useAsync<CalendarView>(
    useCallback(() => getCalendarMonth(db, habitId, month), [habitId, month]),
    [habitId, month],
  );
  const streaks = useAsync<StreaksView>(
    useCallback(() => getStreaksView(db, habitId, 5), [habitId]),
    [habitId],
  );

  const habit = calendar.status === "ready" ? calendar.data.habit : null;
  const selectedDay = calendar.status === "ready"
    ? calendar.data.days.find((d) => d.date === selected) ?? null
    : null;

  const { reload: reloadCalendar } = calendar;
  const { reload: reloadStreaks } = streaks;

  const write = useCallback(async (action: "toggle" | "clear" | { value: number }) => {
    if (!selectedDay) return;
    setBusy(true);
    setWriteError(null);
    try {
      if (action === "toggle") await toggleEntry(db, habitId, selectedDay.date);
      else if (action === "clear") await deleteEntry(db, habitId, selectedDay.date);
      else await setEntry(db, habitId, selectedDay.date, action.value);
      reloadCalendar();
      reloadStreaks();
    } catch (err) {
      setWriteError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  }, [habitId, selectedDay, reloadCalendar, reloadStreaks]);

  return (
    <div className="screen">
      <header className="detail-topbar">
        <button type="button" className="detail-topbar__icon" onClick={onBack} aria-label="Back">
          <ChevronLeftIcon size={20} />
        </button>
        <span className="detail-topbar__title">{habit?.name ?? "…"}</span>
        <span className="detail-topbar__icon" aria-hidden><EditIcon /></span>
      </header>

      {/* A. Calendar */}
      <section className="card">
        <div className="card__head">
          <span className="card__label">Calendar</span>
          {calendar.status === "ready" && (
            <span className="month-nav">
              <button type="button" className="month-nav__btn" aria-label="Previous month"
                disabled={!calendar.data.canGoBack}
                onClick={() => { setSelected(null); setMonth(stepMonth(calendar.data, -1)); }}>
                <ChevronLeftIcon size={14} />
              </button>
              Month
              <button type="button" className="month-nav__btn" aria-label="Next month"
                disabled={!calendar.data.canGoForward}
                onClick={() => { setSelected(null); setMonth(stepMonth(calendar.data, 1)); }}>
                <ChevronRightIcon size={14} />
              </button>
            </span>
          )}
        </div>

        {calendar.status === "loading" && <div className="sk sk--grid" aria-busy="true" aria-label="Loading calendar" />}
        {calendar.status === "error" && <div className="chart__empty" role="alert">{calendar.error.message}</div>}

        {calendar.status === "ready" && (
          <>
            <div className="month-label">{monthLabel(calendar.data.month)}</div>
            <div className="dow-row" aria-hidden>
              {DOW.map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="cal-grid" role="grid" aria-label={`${monthLabel(calendar.data.month)} completion calendar`}>
              {Array.from({ length: calendar.data.leadingBlanks }, (_, i) => <div key={`blank${i}`} />)}
              {calendar.data.days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={[
                    "cal-cell", `lv${day.level}`,
                    day.isToday ? "cal-cell--today" : "",
                    day.inFuture ? "cal-cell--future" : "",
                    day.date === selected ? "cal-cell--selected" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={`${prettyDate(day.date)}: ${describeDay(calendar.data.habit, day)}`}
                  aria-pressed={day.date === selected}
                  onClick={() => setSelected(day.date === selected ? null : day.date)}
                >
                  {day.day}
                </button>
              ))}
            </div>

            <button type="button" className="edit-btn" aria-pressed={editing}
              onClick={() => setEditing((e) => !e)}>
              EDIT
            </button>
            {editing && (
              <div className="edit-hint">
                Editing past days. Pick a day, then choose what to record.
              </div>
            )}

            {selectedDay && (
              <DayPopover
                habit={calendar.data.habit}
                day={selectedDay}
                editing={editing}
                busy={busy}
                onWrite={write}
                onClose={() => setSelected(null)}
              />
            )}

            {writeError && (
              <div className="chart__empty" role="alert">{writeError.message}</div>
            )}
          </>
        )}
      </section>

      {/* B. Best streaks */}
      <section className="card">
        <div className="card__head"><span className="card__label">best streaks</span></div>
        {streaks.status === "loading" && (
          <div aria-busy="true" aria-label="Loading streaks">
            {[0, 1, 2].map((i) => <div key={i} className="sk sk--line" style={{ height: 18, marginBottom: 8 }} />)}
          </div>
        )}
        {streaks.status === "error" && <div className="chart__empty" role="alert">{streaks.error.message}</div>}
        {streaks.status === "ready" && (
          streaks.data.runs.length === 0 ? (
            <div className="chart__empty">No streaks yet — complete this habit to start one.</div>
          ) : (
            streaks.data.runs.map((run) => (
              <div className="streak-row" key={`${run.startDate}-${run.endDate}`}>
                <div className="streak-dates">
                  <span>{prettyDate(run.startDate)}</span>
                  <span>{prettyDate(run.endDate)}</span>
                </div>
                {/* Width is proportional to the longest run; the bar is
                    never empty, so a 1-day streak still reads as a bar. */}
                {/* The unit differs by shape: days for a scheduled
                    habit, weeks or months for a quota one. An unlabelled
                    "4" would read as four days on a 3x/week habit. */}
                <div className="streak-bar" style={{ width: `${Math.max(12, (run.length / streaks.data.longest) * 100)}%` }}>
                  <span>
                    {run.length}
                    {streaks.data.streakUnit === "day" ? "" : ` ${streaks.data.streakUnit}${run.length === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>
            ))
          )
        )}
      </section>

      {/* C. Frequency */}
      <section className="card">
        <div className="card__head"><span className="card__label">frequency</span></div>
        {streaks.status === "loading" && <div className="sk sk--line" style={{ height: 24 }} aria-busy="true" aria-label="Loading frequency" />}
        {/* A quota habit has no weekday pattern, so seven dots would be
            a lie either way: all lit implies daily, none lit implies
            never. It gets its quota and this period's progress instead
            (handoff A4, Layer 2b §2.2). */}
        {streaks.status === "ready" && streaks.data.dots === null && (
          <div className="quota">
            <span className="quota__label">{streaks.data.quotaLabel}</span>
            {streaks.data.quota && (
              <span className="quota__progress">
                {streaks.data.quota.completed} of {streaks.data.quota.required} this{" "}
                {streaks.data.quota.periodEnd === streaks.data.quota.periodStart ? "period" : "week"}
                {streaks.data.quota.met ? " — done" : ` — ${streaks.data.quota.remaining} to go`}
              </span>
            )}
          </div>
        )}
        {streaks.status === "ready" && streaks.data.dots !== null && (
          <div className="freq-row">
            {streaks.data.dots.map((on, i) => (
              <div className="freq-day" key={WEEK_DOT_LABELS[i]}>
                <div className={`freq-dot${on ? "" : " freq-dot--off"}`}
                  role="img"
                  aria-label={`${WEEK_DOT_LABELS[i]}: ${on ? "scheduled" : "not scheduled"}`} />
                <span>{WEEK_DOT_LABELS[i]}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
