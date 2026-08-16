// Layer 1's date validation.
//
// Separate from the repository because it is the one rule the whole
// schema rests on (spec §3): a date is a plain local calendar date, and
// the string must denote a day that actually exists.
//
// A regex alone is not enough, and believing otherwise is how
// "2026-02-30" and "2027-02-29" get stored. Both match the shape; neither
// is a day. Once written, every range query silently includes a date that
// no calendar has, and no later check can tell you what the user meant.
import { ValidationError } from "./errors.js";

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in each month, with February resolved for the given year. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    // The full Gregorian rule, not the "divisible by 4" shorthand: 2100
    // is not a leap year, and a habit app is expected to outlive the
    // shortcut being noticed.
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** True only for a strict YYYY-MM-DD string naming a real calendar day. */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = SHAPE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/**
 * Throws unless `value` is a real calendar date in YYYY-MM-DD form.
 *
 * No bounds on the year: 1970 and 2099 are both storable, deliberately.
 * Someone backfilling a decade of history is doing something reasonable,
 * and a limit invented here would be arbitrary. Lexicographic order
 * remains chronological for any four-digit year, which is the property
 * the range queries depend on.
 */
export function assertDateString(field: string, value: unknown): string {
  if (!isValidDateString(value)) {
    throw new ValidationError(
      field, value,
      "must be a real calendar date in YYYY-MM-DD form (zero-padded, and a day that exists)",
    );
  }
  return value;
}
