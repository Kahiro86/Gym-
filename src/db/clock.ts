// The ONLY place in the codebase permitted to read the current instant.
//
// Spec §3 (Layer 1) requires that "today" have exactly one definition.
// That definition is getToday() in repository.ts, and getToday() is the
// only caller of now() below. An acceptance test greps the whole src/
// tree to prove no other file constructs a Date-of-now.
//
// __setTestClock exists because the database runs inside a Web Worker:
// stubbing the page's global Date does not reach worker scope, so tests
// need an in-band way to pin an instant. Keeping the seam *here*, right
// beside the single read, is what makes the grep-based proof meaningful —
// a test hook scattered across modules would defeat it.

let overrideMs: number | null = null;

export function __setTestClock(ms: number | null): void {
  overrideMs = ms;
}

export function now(): Date {
  return overrideMs !== null ? new Date(overrideMs) : new Date();
}
