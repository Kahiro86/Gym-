// Screen 1 — the habit list.
//
// A rendering layer only: every value shown comes from Layer 2's
// getListView, and every tap goes back out through Layer 2's
// toggleEntry. Nothing here computes a score, a streak, or a cell's
// meaning, and nothing here talks to the database.
import { useCallback, useState } from "react";
import { db } from "../db/index.js";
import { getListView, toggleEntry, DEFAULT_LIST_DAYS } from "../logic/index.js";
import type { CellState, ListCell, ListGroup, ListRow, ListView } from "../logic/index.js";
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

function CellContent({ state, unit }: { state: CellState; unit: string | null }) {
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
    // Genuinely empty. Loop leaves an unlogged past day blank, and any
    // mark of our own here would be a variant Loop does not have — and
    // would read identically to a day the habit was never due.
    case "blank": return null;
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

  return (
    <div className="grid row">
      <button type="button" className="row__name" onClick={() => onOpen(habit)}>
        <span className="row__label">{habit.name}</span>
      </button>

      {cells.map((cell) => {
        const className = [
          "cell",
          cell.state.kind === "complete" ? "cell--complete" : "",
          cell.state.kind === "missed" ? "cell--missed" : "",
          cell.scheduled ? "" : "cell--off",
        ].filter(Boolean).join(" ");
        const content = <CellContent state={cell.state} unit={habit.unit} />;
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

export function ListScreen({ onOpenHabit }: { onOpenHabit: (habit: Habit) => void }) {
  const dayCount = DEFAULT_LIST_DAYS;
  const view = useAsync<ListView>(() => getListView(db, dayCount), [dayCount]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [writeError, setWriteError] = useState<Error | null>(null);

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
        {/* Loop's three top-bar actions. Rendered for layout fidelity;
            the spec defines no behaviour for them, so none is invented. */}
        <span className="topbar__action" aria-hidden><PlusIcon /></span>
        <span className="topbar__action" aria-hidden><FilterIcon /></span>
        <span className="topbar__action" aria-hidden><MoreIcon /></span>
      </header>

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

      {view.status === "ready" && view.data.groups.length === 0 && (
        <div className="notice">
          <div className="notice__title">No habits yet</div>
          <div className="notice__body">
            Habits you add will appear here as a row each, with the last five days beside them.
          </div>
        </div>
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
