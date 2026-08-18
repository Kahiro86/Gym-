// Screen 1 — the habit list.
//
// A rendering layer only: every value shown comes from Layer 2's
// getListView, and every tap goes back out through Layer 2's
// toggleEntry. Nothing here computes a score, a streak, or a cell's
// meaning, and nothing here talks to the database.
import { useCallback, useEffect, useState } from "react";
import { db } from "../db/index.js";
import {
  getListView, toggleEntry, setEntry, deleteEntry, createRoutine,
  getDayStartHour, setDayStartHour, getStorageSummary, checkEviction,
  exportAll, importAll, validateImport, backupFilename, DEFAULT_LIST_DAYS,
} from "../logic/index.js";
import type {
  CellState, ImportReport, ListCell, ListGroup, ListOptions, ListRow, ListView, StorageSummary,
} from "../logic/index.js";
import type { EvictionReport } from "../db/types.js";
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
    case "lapsed": return `${habit.name}, ${cell.date}: the day ended without this being done`;
    case "blank": return `${habit.name}, ${cell.date}: not scheduled`;
  }
}

function CellContent({ state, unit }: { state: CellState; unit: string | null }) {
  switch (state.kind) {
    case "complete": return <CheckIcon />;
    // A miss the user recorded deliberately.
    case "missed": return <XIcon />;
    case "today": return <span className="cell__ring" />;
    // The day ended with nothing logged. A dash, not a blank: the cell
    // is not waiting for anything any more, and it is not the same as a
    // day the habit was never due.
    case "lapsed": return <span className="cell__dash" />;
    case "numeric":
      return (
        <span className="cell__value">
          {state.value}
          {unit ? <span className="cell__unit">{unit}</span> : null}
        </span>
      );
    case "blank": return null;
  }
}

/**
 * Inline amount entry for a measurable habit.
 *
 * Tapping such a cell used to open the habit's detail screen, on the
 * reasoning that a tap cannot invent an amount. True, but the
 * consequence was that the one gesture the app is built around did
 * nothing on a measurable habit — it navigated away from the list. Asking
 * for the number here keeps the tap where the user aimed it.
 */
function AmountEntry({ habit, date, current, onSave, onClear, onCancel }: {
  habit: Habit;
  date: string;
  current: number | null;
  onSave: (value: number) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(current === null ? "" : String(current));
  const value = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(value) && value >= 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <>
      <div className="sheet__backdrop" onClick={onCancel} aria-hidden />
      <div className="amount" role="dialog" aria-label={`${habit.name} on ${date}`}>
        <div className="amount__head">
          <span className="amount__name">{habit.name}</span>
          <span className="amount__date">{date}</span>
        </div>
        <div className="amount__row">
          <input
            className="amount__input"
            inputMode="decimal"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && valid) onSave(value); }}
            aria-label={`Amount${habit.unit ? ` in ${habit.unit}` : ""}`}
            placeholder={habit.target == null ? "" : String(habit.target)}
          />
          {habit.unit ? <span className="amount__unit">{habit.unit}</span> : null}
          <button type="button" className="amount__save" disabled={!valid} onClick={() => onSave(value)}>
            Save
          </button>
        </div>
        <div className="amount__row">
          {/* 0 is a real answer, not an empty one: it records that the
              day was missed on purpose. Kept separate from Clear. */}
          <button type="button" className="amount__action" onClick={() => onSave(0)}>
            Mark as missed
          </button>
          <button
            type="button"
            className="amount__action"
            disabled={current === null}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
    </>
  );
}

function HabitRow({ row, onToggle, onOpen, onEnterAmount }: {
  row: ListRow;
  onToggle: (habitId: string, date: string) => void;
  onOpen: (habit: Habit) => void;
  onEnterAmount: (habit: Habit, cell: ListCell) => void;
}) {
  const { habit, cells } = row;
  // A boolean cell cycles in place; a measurable one asks for the
  // amount. Neither navigates — only the habit's name does that.
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
        const content = <CellContent state={cell.state} unit={habit.unit} />;
        const label = cellDescription(habit, cell);
        // A day the habit was never due has nothing to record.
        const actionable = cell.scheduled;

        return (
          <button
            key={cell.date}
            type="button"
            className={className}
            disabled={!actionable}
            aria-label={actionable && !cycles ? `${label}. Enter an amount.` : label}
            onClick={() => {
              if (!actionable) return;
              if (cycles) onToggle(habit.id, cell.date);
              else onEnterAmount(habit, cell);
            }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function Group({ group, collapsed, onToggleCollapse, onToggle, onOpen, onEnterAmount }: {
  group: ListGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggle: (habitId: string, date: string) => void;
  onOpen: (habit: Habit) => void;
  onEnterAmount: (habit: Habit, cell: ListCell) => void;
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
          <HabitRow
            key={row.habit.id}
            row={row}
            onToggle={onToggle}
            onOpen={onOpen}
            onEnterAmount={onEnterAmount}
          />
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

/**
 * Backup: download everything, or restore from a file.
 *
 * Built because the local database is evictable and sync is not live —
 * this is currently the only way a year of history can be got off the
 * device. A restore always shows what the file contains and what will
 * happen to what is already here, before anything is written.
 */
function BackupSection({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ json: unknown; report: ImportReport; name: string } | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");

  const download = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const file = await exportAll(db);
      const name = backupFilename(file.exportedAt);
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNote(`Saved ${name} — ${file.habits.length} habits, ${file.entries.length} logged days.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        setError(`${file.name} is not valid JSON.`);
        return;
      }
      const current = Number((await db.getMeta("schema_version")) ?? 0);
      // Reported before anything is written, always.
      setPending({ json, report: validateImport(json, current), name: file.name });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      const { result } = await importAll(db, pending.json, { mode, confirmed: true });
      if (result) {
        setNote(
          `Imported ${result.habits} habits and ${result.entries} logged days`
          + (result.skipped ? `, keeping ${result.skipped} newer local rows` : "")
          + (result.cleared ? ", after clearing what was here" : "") + ".",
        );
        setPending(null);
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet__section">
      <span className="sheet__label">Backup</span>
      <span className="sheet__hint">
        Your habits live on this device. Browsers can clear that storage, so keep a copy.
      </span>

      <div className="sheet__inline">
        <button type="button" className="sheet__button" disabled={busy} onClick={download}>
          Download
        </button>
        <label className="sheet__button sheet__button--file">
          Restore
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Choose a backup file"
            onChange={(e) => void choose(e.target.files)}
          />
        </label>
      </div>

      {pending && (
        <div className="backup" role="dialog" aria-label="Confirm import">
          <div className="sheet__label">{pending.name}</div>
          <span className="sheet__hint">
            {pending.report.counts.habits} habits, {pending.report.counts.routines} groups,{" "}
            {pending.report.counts.entries} logged days
            {pending.report.exportedAt ? `, saved ${pending.report.exportedAt.slice(0, 10)}` : ""}.
          </span>

          {pending.report.errors.length > 0 && (
            <div className="backup__errors" role="alert">
              <div className="sheet__label">This file cannot be imported</div>
              {pending.report.errors.slice(0, 6).map((p, i) => (
                <div className="backup__problem" key={i}>{p.at}: {p.message}</div>
              ))}
              {pending.report.errors.length > 6 && (
                <div className="backup__problem">…and {pending.report.errors.length - 6} more.</div>
              )}
            </div>
          )}

          {pending.report.warnings.map((p, i) => (
            <div className="sheet__hint" key={i}>{p.message}</div>
          ))}

          {pending.report.ok && (
            <>
              <div className="segmented" role="group" aria-label="How to import">
                <button
                  type="button" className="segmented__option" aria-pressed={mode === "merge"}
                  onClick={() => setMode("merge")}
                >
                  Merge
                </button>
                <button
                  type="button" className="segmented__option" aria-pressed={mode === "replace"}
                  onClick={() => setMode("replace")}
                >
                  Replace
                </button>
              </div>
              <span className="sheet__hint">
                {mode === "merge"
                  ? "Adds what is missing and updates anything the file has a newer version of. Nothing is deleted."
                  : "Deletes everything on this device first, then restores the file exactly. This cannot be undone."}
              </span>
            </>
          )}

          <div className="amount__row">
            <button type="button" className="amount__action" onClick={() => setPending(null)}>
              Cancel
            </button>
            {pending.report.ok && (
              <button
                type="button"
                className={mode === "replace" ? "backup__danger" : "sheet__button"}
                disabled={busy}
                onClick={confirmImport}
              >
                {mode === "replace" ? "Erase and restore" : "Merge in"}
              </button>
            )}
          </div>
        </div>
      )}

      {note && <span className="sheet__hint">{note}</span>}
      {error && <div className="sheet__error" role="alert">{error}</div>}
    </div>
  );
}

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

      <BackupSection onChanged={onChanged} />

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
  const [evicted, setEvicted] = useState<EvictionReport | null>(null);
  const [amount, setAmount] = useState<{ habit: Habit; cell: ListCell } | null>(null);
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

  // Spec §9.12 test 59. An empty database is not automatically a new
  // one, and saying "no habits yet" to someone whose history the browser
  // evicted would be a lie they have no way to check.
  useEffect(() => {
    checkEviction(db).then(setEvicted, () => setEvicted(null));
  }, []);

  const closeAmount = useCallback(() => setAmount(null), []);

  /** One path for every amount-entry outcome, so all three report failure. */
  const writeAmount = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      setWriteError(null);
      await fn();
      setAmount(null);
      reload();
    } catch (err) {
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

      {evicted && (
        <div className="notice notice--error" role="alert">
          <div className="notice__title">Your saved habits are gone</div>
          <div className="notice__body">
            This browser last held {evicted.lastKnownHabits} habit
            {evicted.lastKnownHabits === 1 ? "" : "s"} and {evicted.lastKnownEntries} logged
            day{evicted.lastKnownEntries === 1 ? "" : "s"}, on{" "}
            {evicted.lastSeenAt.slice(0, 10)}. The database is now empty, which usually means
            the browser cleared it to free space. Anything that had synced to a server is safe;
            anything that had not is lost.
          </div>
        </div>
      )}

      {amount && (
        <AmountEntry
          habit={amount.habit}
          date={amount.cell.date}
          current={amount.cell.state.kind === "numeric" ? amount.cell.state.value : null}
          onSave={(value) => void writeAmount(() => setEntry(db, amount.habit.id, amount.cell.date, value))}
          onClear={() => void writeAmount(() => deleteEntry(db, amount.habit.id, amount.cell.date))}
          onCancel={closeAmount}
        />
      )}

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
            onEnterAmount={(habit, cell) => setAmount({ habit, cell })}
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
