// Day/week boundary logic (spec §4) — the ONE place in Layer 2 that knows
// what "today" or "this week" means. No repository, cache, or future UI
// component computes this independently.
//
// Day boundary: local midnight, in whichever timezone the *event itself*
// was captured in — not the device's current timezone. Every session
// captures its own tzOffsetMinutes at creation (JS Date#getTimezoneOffset
// convention: positive when local time is BEHIND UTC), and every boundary
// function here takes that offset as an explicit argument rather than
// reading the system clock. This is what keeps a user's history stable
// across relocation: a session logged in Tokyo stays grouped into Tokyo's
// calendar days/weeks forever, even after the user moves to Denver.
//
// Week start: fixed at Monday (decided — not a user setting, unlike the
// spec's suggested §8 table; see settings comments in types.ts).

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// getTimezoneOffset() at a given instant — DST-aware because Date itself
// is DST-aware for the *system's* zone. Capture this once, at write time;
// never recompute it later for the same event.
export function captureTzOffsetMinutes(epochMs: number = Date.now()): number {
  return new Date(epochMs).getTimezoneOffset();
}

function toLocalMs(epochMs: number, tzOffsetMinutes: number): number {
  return epochMs - tzOffsetMinutes * 60_000;
}

// Epoch-day index of the local calendar day `epochMs` falls in, per the
// given offset. 1970-01-01 UTC is day 0.
export function localDayIndex(epochMs: number, tzOffsetMinutes: number): number {
  return Math.floor(toLocalMs(epochMs, tzOffsetMinutes) / DAY_MS);
}

// Epoch-ms (in UTC-epoch terms) of local midnight for the day `epochMs`
// falls in — the moment `localDayIndex` would tick over.
export function localDayStart(epochMs: number, tzOffsetMinutes: number): number {
  return localDayIndex(epochMs, tzOffsetMinutes) * DAY_MS + tzOffsetMinutes * 60_000;
}

// Monday-start week index. 1970-01-01 was a Thursday (day 0); shifting by
// +3 days lands day indices on a Monday-anchored week grid — day 4
// (1970-01-05, a Monday) divides evenly by 7, confirmed against the
// calendar in this module's tests.
export function localWeekIndex(epochMs: number, tzOffsetMinutes: number): number {
  return Math.floor((localDayIndex(epochMs, tzOffsetMinutes) + 3) / 7);
}

export function localWeekStart(epochMs: number, tzOffsetMinutes: number): number {
  const weekIndex = localWeekIndex(epochMs, tzOffsetMinutes);
  return weekIndex * WEEK_MS - 3 * DAY_MS + tzOffsetMinutes * 60_000;
}

// Each side uses its OWN captured offset — this is deliberate, not an
// oversight. Two events belong to "the same local day/week" from each
// event's own point of view at the time it happened, which is exactly the
// relocation-stability guarantee described above.
export function isSameLocalDay(aEpochMs: number, aTzOffsetMinutes: number, bEpochMs: number, bTzOffsetMinutes: number): boolean {
  return localDayIndex(aEpochMs, aTzOffsetMinutes) === localDayIndex(bEpochMs, bTzOffsetMinutes);
}

export function isSameLocalWeek(aEpochMs: number, aTzOffsetMinutes: number, bEpochMs: number, bTzOffsetMinutes: number): boolean {
  return localWeekIndex(aEpochMs, aTzOffsetMinutes) === localWeekIndex(bEpochMs, bTzOffsetMinutes);
}
