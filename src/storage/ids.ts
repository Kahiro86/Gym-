import { uuidv7 } from "uuidv7";

// Time-sortable, collision-free across devices, no server round-trip
// needed to allocate one (spec §3). Used for every record id.
export function newId(): string {
  return uuidv7();
}

// Unix epoch milliseconds, integer, UTC — never local time or ISO strings
// for anything used in ordering (spec §3).
export function now(): number {
  return Date.now();
}
