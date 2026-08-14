// The only place `new Date()` may be called to determine "now" for the
// purpose of deciding the current habit-day. getToday() (in repository.ts)
// is the only caller. Everything else that needs "today" calls getToday(),
// never this module and never `new Date()` directly.
//
// __setTestClock exists so acceptance tests can pin an exact instant without
// faking the whole browser clock (which would not reliably reach code
// running inside a Worker). It is never called by production UI code.

let overrideMs: number | null = null;

export function __setTestClock(ms: number | null): void {
  overrideMs = ms;
}

export function now(): Date {
  return overrideMs !== null ? new Date(overrideMs) : new Date();
}
