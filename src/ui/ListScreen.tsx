// Screen 1 — the habit list.
//
// A rendering layer only: every value shown comes from Layer 2's
// getListView, and every tap goes back out through Layer 2's
// toggleEntry. Nothing here computes a score, a streak, or a cell's
// meaning, and nothing here talks to the database.
import { useCallback, useEffect, useState } from "react";
import { db } from "../db/index.js";
import {
  getListView, toggleEntry, createRoutine, getDayStartHour, setDayStartHour,
  getStorageSummary, DEFAULT_LIST_DAYS,
} from "../logic/index.js";
import type {
  CellState, ListCell, ListGroup, ListOptions, ListRow, ListView, StorageSummary,
} from "../logic/index.js";
import type { Habit } from "../db/types.js";
import { useAsync } from "./useAsync.js";
import { CheckIcon, XIcon, PlusIcon, FilterIcon, MoreIcon, ChevronDownIcon, ChevronRightIcon } from "./icons.js";
import "./ListScreen.css";

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The facts that decide whether the database can open at all. Shown
 * beside a storage failure so the report is diagnosable from a phone,
 * without a cable and a DevTools window.
 */
function storageDiagnostics(): string {
  const anyNav = navigator as Navigator & { storage?: StorageManager };
  return [
    `opfs=${typeof anyNav.storage?.getDirectory === "function"}`,
    `syncAccessHandle=${typeof FileSystemFileHandle !== "undefined"
      && "createSyncAccessHandle" in FileSystemFileHandle.prototype}`,
    `webLocks=${"locks" in navigator}`,
    `secureContext=${window.isSecureContext}`,
  ].join("  ");
}

/** Column heading: weekday over day-of-month, e.g. THU / 25. */
function dayLabel(dateStr: string): { weekday: string; day: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { weekday: WEEKDAY[new Date(y, m - 1, d).getDay()], day: String(d) };
}

/** Spoken form of a cell, so the grid is usable without sight of it. */
function cellDescription(habit: Habit, cell: ListCell): string {
  switch (cell.state.kind) {
    case "complete": return `${habit.name}, ${cell.date}: completed`;
    case "missed": return `${habit.name}, ${cell.date}: missed`;
    case "today": return `${habit.name}, today: not logged yet`;
    case "numeric": return `${habit.name}, ${cell.date}: ${cell.state.value}${habit.unit ? ` ${habit.unit}` : ""}`;
    case "blank": return cell.scheduled
      ? `${habit.name}, ${cell.date}: no entry`
      : `${habit.name}, ${cell.date}: not scheduled`;
  }
}

function CellContent({ state, unit, scheduled }: {
  state: CellState;
  unit: string | null;
  scheduled: boolean;
}) {
  switch (state.kind) {
    case "complete": return <CheckIcon />;
    case "missed": return <XIcon />;
    case "today": return <span className="cell__ring" />;
    case "numeric":
      return (
        <span className="cell__value">
          {state.value}
          {unit ? <span className="cell__unit">{unit}</span> : null}
        </span>
      );
    // Loop leaves an unlogged past day completely blank. That reads as
    // "nothing here" rather than "you can still fill this in", and a day
    // the habit was never due looks identical to one you simply have not
    // ticked yet. A faint dot on the scheduled days says which cells are
    // yours to fill; a day off stays empty.
    case "blank": return scheduled ? <span className="cell__todo" /> : null;
  }
}

function HabitRow({ row, onToggle, onOpen }: {
  row: ListRow;
  onToggle: (habitId: string, date: string) => void;
  onOpen: (habit: Habit) => void;
}) {
  const { habit, cells } = row;
  // Boolean cells cycle in place. A numeric cell cannot — it needs an
  // amount, and inventing one on tap would be fabricating data — so it
  // opens the habit instead, where a value can actually be entered.
  const cycles = habit.type === "boolean";

  const archived = habit.archivedAt !== null;

  return (
    <div className={`grid row${archived ? " row--archived" : ""}`}>
      <button type="button" className="row__name" onClick={() => onOpen(habit)}>
        <span className="row__label">{habit.name}</span>
        {/* Dimming alone would read as a rendering glitch, so the state
            is also stated. */}
        {archived ? <span className="row__archived">archived</span> : null}
      </button>

      {cells.map((cell) => {
        const className = [
          "cell",
          cell.state.kind === "complete" ? "cell--complete" : "",
          cell.state.kind === "missed" ? "cell--missed" : "",
          cell.scheduled ? "" : "cell--off",
        ].filter(Boolean).join(" ");
        const content = <CellContent state={cell.state} unit={habit.unit} scheduled={cell.scheduled} />;
        const label = cellDescription(habit, cell);

        return (
          <button
            key={cell.date}
            type="button"
            className={className}
            aria-label={cycles ? label : `${label}. Opens ${habit.name} to enter a value.`}
            onClick={() => (cycles ? onToggle(habit.id, cell.date) : onOpen(habit))}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function Group({ group, collapsed, onToggleCollapse, onToggle, onOpen }: {
  group: ListGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggle: (habitId: string, date: string) => void;
  onOpen: (habit: Habit) => void;
}) {
  const name = group.routine?.name ?? "Habits";
  const groupId = group.routine?.id ?? "loose";
  return (
    <>
      <button
        type="button"
        className={`group${group.routine ? "" : " group--loose"}`}
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-controls={`group-${groupId}`}
      >
        {collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
        <span>{name}</span>
      </button>
      <div id={`group-${groupId}`} hidden={collapsed}>
        {group.rows.map((row) => (
          <HabitRow key={row.habit.id} row={row} onToggle={onToggle} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

/**
 * A sheet hanging from the top bar. Both menus use it, so they dismiss
 * the same way: tap the backdrop, or press Escape.
 */
function Sheet({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Catches the tap that means "somewhere else". Not focusable —
          Escape and the close button are the keyboard routes out. */}
      <div className="sheet__backdrop" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet__title">{title}</div>
        {children}
      </div>
    </>
  );
}

function SheetToggle({ label, hint, on, onChange }: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button type="button" className="sheet__row" aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="sheet__check">{on ? <CheckIcon size={14} /> : null}</span>
      <span>
        <span className="sheet__label">{label}</span>
        {hint ? <span className="sheet__hint">{hint}</span> : null}
      </span>
    </button>
  );
}

/** Filter: what the list leaves out. */
function FilterSheet({ options, onChange, onClose }: {
  options: ListOptions;
  onChange: (next: ListOptions) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Filter" onClose={onClose}>
      <SheetToggle
        label="Show archived"
        hint="Habits you have retired, with their history intact."
        on={!!options.includeArchived}
        onChange={(v) => onChange({ ...options, includeArchived: v })}
      />
      <SheetToggle
        label="Hide done today"
        hint="Leaves only what is still outstanding."
        on={!!options.hideCompletedToday}
        onChange={(v) => onChange({ ...options, hideCompletedToday: v })}
      />
    </Sheet>
  );
}

const SYNC_WORDING: Record<StorageSummary["syncState"], string> = {
  synced: "Everything is on the server.",
  pending: "Some changes have not reached the server yet.",
  // Honest rather than alarming: no backend is configured yet, so there
  // is genuinely nowhere for the queue to go.
  offline: "Saved on this device. No server is connected yet.",
  error: "A change was refused by the server.",
};

/** Overflow: settings and the things that are not per-habit. */
function MoreSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [groupName, setGroupName] = useState("");
  const [dayStart, setDayStart] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDayStartHour(db).then(setDayStart, () => setDayStart(null));
    getStorageSummary(db).then(setStorage, () => setStorage(null));
  }, []);

  const addGroup = async () => {
    if (!groupName.trim()) return;
    try {
      await createRoutine(db, groupName);
      setGroupName("");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const changeDayStart = async (hour: number) => {
    setDayStart(hour);
    try {
      await setDayStartHour(db, hour);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Sheet title="More" onClose={onClose}>
      <div className="sheet__section">
        <label className="sheet__label" htmlFor="new-group">New group</label>
        <div className="sheet__inline">
          <input
            id="new-group"
            className="sheet__input"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addGroup(); }}
            placeholder="Morning"
          />
          <button type="button" className="sheet__button" onClick={addGroup} disabled={!groupName.trim()}>
            Add
          </button>
        </div>
        <span className="sheet__hint">Groups let you sort habits under a heading.</span>
      </div>

      <div className="sheet__section">
        <label className="sheet__label" htmlFor="day-start">The day starts at</label>
        <select
          id="day-start"
          className="sheet__input"
          value={dayStart ?? 4}
          disabled={dayStart === null}
          onChange={(e) => void changeDayStart(Number(e.target.value))}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
          ))}
        </select>
        <span className="sheet__hint">
          A tick logged before this hour counts for the day before. Changing it never
          re-dates anything already logged.
        </span>
      </div>

      <div className="sheet__section">
        <span className="sheet__label">Storage</span>
        <span className="sheet__hint">
          {storage
            ? `${SYNC_WORDING[storage.syncState]} ${storage.pending} change${storage.pending === 1 ? "" : "s"} queued. `
              + `Stored in ${storage.vfsName}, ${storage.persisted ? "protected from eviction" : "which the browser may evict under storage pressure"}.`
            : "Reading…"}
        </span>
      </div>

      {error && <div className="sheet__error" role="alert">{error}</div>}
    </Sheet>
  );
}

/** Shown while the first read is in flight — never a blank screen. */
function Skeleton({ dayCount }: { dayCount: number }) {
  return (
    <div aria-busy="true" aria-label="Loading habits">
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="grid row" key={i}>
          <div className="skeleton__bar" style={{ width: `${70 - i * 6}%` }} />
          {Array.from({ length: dayCount }, (_, c) => (
            <div className="cell" key={c}>
              <div className="skeleton__bar" style={{ width: 13, height: 13, borderRadius: "50%" }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ListScreen({ onOpenHabit, onAddHabit }: {
  onOpenHabit: (habit: Habit) => void;
  onAddHabit: () => void;
}) {
  const dayCount = DEFAULT_LIST_DAYS;
  const [options, setOptions] = useState<ListOptions>({});
  const [sheet, setSheet] = useState<"filter" | "more" | null>(null);
  const view = useAsync<ListView>(
    () => getListView(db, dayCount, options),
    [dayCount, options.includeArchived, options.hideCompletedToday],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [writeError, setWriteError] = useState<Error | null>(null);
  const filtering = !!options.includeArchived || !!options.hideCompletedToday;

  const { reload } = view;
  const handleToggle = useCallback(async (habitId: string, date: string) => {
    try {
      setWriteError(null);
      await toggleEntry(db, habitId, date);
      reload();
    } catch (err) {
      // A failed write must be visible, not swallowed into a cell that
      // silently refuses to change (non-negotiable #6).
      setWriteError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [reload]);

  const days = view.status === "ready" ? view.data.days : Array.from({ length: dayCount }, (_, i) => String(i));
  const today = view.status === "ready" ? view.data.today : null;

  return (
    <div className="screen" style={{ ["--day-count" as string]: dayCount }}>
      <header className="topbar">
        <span className="topbar__title">Habits</span>
        <button type="button" className="topbar__action" onClick={onAddHabit} aria-label="Add a habit">
          <PlusIcon />
        </button>
        <button
          type="button"
          className={`topbar__action${filtering ? " topbar__action--on" : ""}`}
          onClick={() => setSheet(sheet === "filter" ? null : "filter")}
          aria-expanded={sheet === "filter"}
          aria-label={filtering ? "Filter — some habits are hidden" : "Filter"}
        >
          <FilterIcon />
        </button>
        <button
          type="button"
          className="topbar__action"
          onClick={() => setSheet(sheet === "more" ? null : "more")}
          aria-expanded={sheet === "more"}
          aria-label="More"
        >
          <MoreIcon />
        </button>
      </header>

      {sheet === "filter" && (
        <FilterSheet options={options} onChange={setOptions} onClose={() => setSheet(null)} />
      )}
      {sheet === "more" && (
        <MoreSheet onClose={() => setSheet(null)} onChanged={reload} />
      )}

      <div className="grid colheader">
        <div />
        {days.map((date) => {
          if (view.status !== "ready") return <div className="colheader__day" key={date} />;
          const { weekday, day } = dayLabel(date);
          return (
            <div className={`colheader__day${date === today ? " colheader__day--today" : ""}`} key={date}>
              {weekday}
              <span className="colheader__date">{day}</span>
            </div>
          );
        })}
      </div>

      {view.status === "loading" && <Skeleton dayCount={dayCount} />}

      {view.status === "error" && (
        <div className="notice notice--error" role="alert">
          <div className="notice__title">Could not open your habits</div>
          <div className="notice__body">
            The database did not start. Nothing has been lost — the app simply cannot read it right now.
          </div>
          <div className="notice__detail">{view.error.message}</div>
          {/* Which browser capability was missing, in the failure's own
              terms. The commonest cause is now a second tab holding the
              database, which a reload from here resolves. */}
          <div className="notice__detail">{storageDiagnostics()}</div>
          <button type="button" className="notice__retry" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      )}

      {/* An empty list because everything is filtered out is a different
          situation from having no habits, and offering "add your first
          habit" to someone who has ten would be nonsense. */}
      {view.status === "ready" && view.data.groups.length === 0 && (
        filtering ? (
          <div className="notice">
            <div className="notice__title">Nothing matches the filter</div>
            <div className="notice__body">
              Your habits are still here — the current filter just hides all of them.
            </div>
            <button type="button" className="notice__retry" onClick={() => setOptions({})}>
              Clear the filter
            </button>
          </div>
        ) : (
          <div className="notice">
            <div className="notice__title">No habits yet</div>
            <div className="notice__body">
              Habits you add will appear here as a row each, with the last five days beside them.
            </div>
            {/* The empty state is where someone is most likely to be
                looking for the way in, so it offers one rather than only
                pointing at an icon in the corner. */}
            <button type="button" className="notice__retry" onClick={onAddHabit}>
              Add your first habit
            </button>
          </div>
        )
      )}

      {view.status === "ready" && view.data.groups.map((group) => {
        const key = group.routine?.id ?? "loose";
        return (
          <Group
            key={key}
            group={group}
            collapsed={collapsed[key] ?? false}
            onToggleCollapse={() => setCollapsed((c) => ({ ...c, [key]: !(c[key] ?? false) }))}
            onToggle={handleToggle}
            onOpen={onOpenHabit}
          />
        );
      })}

      {writeError && (
        <div className="notice notice--error" role="alert">
          <div className="notice__title">That tap did not save</div>
          <div className="notice__detail">{writeError.message}</div>
        </div>
      )}
    </div>
  );
}
