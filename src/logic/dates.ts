// Pure calendar arithmetic over "YYYY-MM-DD" local date strings. No
// database, no DOM, and deliberately no notion of "now" — every function
// takes the dates it operates on. ("Today" is Layer 1's getToday(); the
// facade passes it down.)
//
// Dates are parsed with the numeric Date constructor, never
// `new Date("YYYY-MM-DD")`: the string form is defined to parse as UTC
// midnight and lands on the previous day for anyone west of UTC — the
// exact class of bug Layer 1's date rules exist to prevent.

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function toDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function fromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

/** Whole days from a to b; negative when b precedes a. */
export function daysBetween(a: string, b: string): number {
  // Anchored at noon so a DST transition inside the interval can never
  // round the division to the wrong whole day.
  const ms = toDate(b).setHours(12) - toDate(a).setHours(12);
  return Math.round(ms / 86_400_000);
}

/** 0=Sun … 6=Sat, matching the spec's frequencyDays convention. */
export function dayOfWeek(dateStr: string): number {
  return toDate(dateStr).getDay();
}

/** Inclusive [a, b]. Empty when a > b. */
export function dateRange(a: string, b: string): string[] {
  if (a > b) return [];
  const out: string[] = new Array(daysBetween(a, b) + 1);
  let cur = a;
  for (let i = 0; i < out.length; i++) {
    out[i] = cur;
    cur = addDays(cur, 1);
  }
  return out;
}

/** Sunday-anchored, matching dayOfWeek's 0=Sun convention. */
export function weekStart(dateStr: string): string {
  return addDays(dateStr, -dayOfWeek(dateStr));
}

/** "YYYY-MM" */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function daysInMonth(yyyymm: string): number {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of the next month
}

export function firstOfMonth(yyyymm: string): string {
  return `${yyyymm}-01`;
}

export function lastOfMonth(yyyymm: string): string {
  return `${yyyymm}-${pad2(daysInMonth(yyyymm))}`;
}

export function shiftMonth(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export const minDate = (a: string, b: string): string => (a < b ? a : b);
export const maxDate = (a: string, b: string): string => (a > b ? a : b);

export const clamp = (dateStr: string, lo: string, hi: string): string =>
  maxDate(lo, minDate(dateStr, hi));

/**
 * The local calendar date an already-recorded ISO timestamp falls on
 * (e.g. habit.createdAt). This parses a value that is already stored —
 * it does not read the current instant, which remains Layer 1's job.
 */
export function instantToDateStr(iso: string): string {
  return fromDate(new Date(iso));
}
