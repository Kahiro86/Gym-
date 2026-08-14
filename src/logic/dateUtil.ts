// Pure calendar-string arithmetic for Layer 2. No DB, no DOM, no "now" —
// every function here takes explicit date strings and never determines
// the current day itself (that's Layer 1's getToday(), called by the
// functions in this layer that need "today" as their anchor).
//
// All dates are "YYYY-MM-DD" local calendar strings, matching Layer 1's
// storage format. Parsing them with `new Date(y, m-1, d)` (numeric-args
// constructor) is deliberate: `new Date("YYYY-MM-DD")` parses as UTC
// midnight per the ISO-8601 date-only rule and can land on the wrong
// local day — the exact bug Layer 1's date handling was built to avoid.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseDateStr(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function toLocalDate(s: string): Date {
  const { y, m, d } = parseDateStr(s);
  return new Date(y, m - 1, d);
}

function fromLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = toLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return fromLocalDate(d);
}

// 0=Sun..6=Sat, matching the spec's frequencyDays convention.
export function dayOfWeek(dateStr: string): number {
  return toLocalDate(dateStr).getDay();
}

export function compareDateStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Inclusive list of every date string between a and b (a <= b).
export function dateRange(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a;
  while (compareDateStr(cur, b) <= 0) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// Sunday-anchored week start (matches dayOfWeek's 0=Sun convention).
export function weekStart(dateStr: string): string {
  return addDays(dateStr, -dayOfWeek(dateStr));
}

export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

export function daysInMonth(yyyymm: string): number {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
}

export function firstOfMonth(yyyymm: string): string {
  return `${yyyymm}-01`;
}

export function shiftMonth(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// Distinct Sunday-anchored weeks (by their start date) touched by [a,b].
export function weeksTouched(a: string, b: string): string[] {
  const seen = new Set<string>();
  for (const d of dateRange(a, b)) seen.add(weekStart(d));
  return [...seen].sort();
}

// Distinct months ("YYYY-MM") touched by [a,b].
export function monthsTouched(a: string, b: string): string[] {
  const seen = new Set<string>();
  for (const d of dateRange(a, b)) seen.add(monthOf(d));
  return [...seen].sort();
}

// Parses a genuine timestamp (habit.createdAt, an ISO instant — NOT "now")
// down to the local calendar date it falls on. This takes an explicit
// argument, so it is not the "current instant" pattern Layer 1's clock.ts
// guards — it is ordinary parsing of an already-recorded value.
export function isoInstantToLocalDateStr(iso: string): string {
  return fromLocalDate(new Date(iso));
}
