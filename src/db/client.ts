// Main-thread async client. Implements the same `Db` interface the rest of
// the app depends on (types.ts) — the Worker underneath is an
// implementation detail nothing above this module ever sees.
import { reviveError } from "./errors.js";
import type { Db } from "./types.js";

interface RpcSuccess { id: number; ok: true; result: unknown }
interface RpcFailure { id: number; ok: false; error: { name: string; message: string; extra?: Record<string, unknown> } }

class DbClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<RpcSuccess | RpcFailure>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(reviveError(msg.error));
    };
  }

  call(method: string, args: unknown[]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }
}

// Builds a `Db` implementation where every method is a thin call() wrapper.
// TypeScript can't derive this generically without losing per-method
// argument/return types, so each method is spelled out — this is the
// contract the rest of the app codes against.
export function createDbClient(): Db {
  const c = new DbClient();
  return {
    createRoutine: (data) => c.call("createRoutine", [data]) as ReturnType<Db["createRoutine"]>,
    getRoutine: (id) => c.call("getRoutine", [id]) as ReturnType<Db["getRoutine"]>,
    listRoutines: (opts) => c.call("listRoutines", [opts]) as ReturnType<Db["listRoutines"]>,
    updateRoutine: (id, patch) => c.call("updateRoutine", [id, patch]) as ReturnType<Db["updateRoutine"]>,
    archiveRoutine: (id) => c.call("archiveRoutine", [id]) as ReturnType<Db["archiveRoutine"]>,
    deleteRoutine: (id) => c.call("deleteRoutine", [id]) as ReturnType<Db["deleteRoutine"]>,
    reorderRoutines: (orderedIds) => c.call("reorderRoutines", [orderedIds]) as ReturnType<Db["reorderRoutines"]>,

    createHabit: (data) => c.call("createHabit", [data]) as ReturnType<Db["createHabit"]>,
    getHabit: (id) => c.call("getHabit", [id]) as ReturnType<Db["getHabit"]>,
    listHabits: (opts) => c.call("listHabits", [opts]) as ReturnType<Db["listHabits"]>,
    updateHabit: (id, patch) => c.call("updateHabit", [id, patch]) as ReturnType<Db["updateHabit"]>,
    archiveHabit: (id) => c.call("archiveHabit", [id]) as ReturnType<Db["archiveHabit"]>,
    unarchiveHabit: (id) => c.call("unarchiveHabit", [id]) as ReturnType<Db["unarchiveHabit"]>,
    deleteHabit: (id, opts) => c.call("deleteHabit", [id, opts]) as ReturnType<Db["deleteHabit"]>,
    reorderHabits: (orderedIds) => c.call("reorderHabits", [orderedIds]) as ReturnType<Db["reorderHabits"]>,

    getEntry: (habitId, date) => c.call("getEntry", [habitId, date]) as ReturnType<Db["getEntry"]>,
    getEntriesForHabit: (habitId, s, e) => c.call("getEntriesForHabit", [habitId, s, e]) as ReturnType<Db["getEntriesForHabit"]>,
    getEntriesForDate: (date) => c.call("getEntriesForDate", [date]) as ReturnType<Db["getEntriesForDate"]>,
    getEntriesForHabits: (habitIds, s, e) => c.call("getEntriesForHabits", [habitIds, s, e]) as ReturnType<Db["getEntriesForHabits"]>,
    setEntry: (habitId, date, value, note) => c.call("setEntry", [habitId, date, value, note]) as ReturnType<Db["setEntry"]>,
    deleteEntry: (habitId, date) => c.call("deleteEntry", [habitId, date]) as ReturnType<Db["deleteEntry"]>,
    getFirstEntryDate: (habitId) => c.call("getFirstEntryDate", [habitId]) as ReturnType<Db["getFirstEntryDate"]>,
    getEntryCount: (habitId) => c.call("getEntryCount", [habitId]) as ReturnType<Db["getEntryCount"]>,

    getToday: () => c.call("getToday", []) as ReturnType<Db["getToday"]>,
    getDayStartHour: () => c.call("getDayStartHour", []) as ReturnType<Db["getDayStartHour"]>,
    setDayStartHour: (hour) => c.call("setDayStartHour", [hour]) as ReturnType<Db["setDayStartHour"]>,
    getMeta: (key) => c.call("getMeta", [key]) as ReturnType<Db["getMeta"]>,
    setMeta: (key, value) => c.call("setMeta", [key, value]) as ReturnType<Db["setMeta"]>,

    __setTestClock: (ms) => c.call("__setTestClock", [ms]) as ReturnType<Db["__setTestClock"]>,
    __getQueryCount: () => c.call("__getQueryCount", []) as ReturnType<Db["__getQueryCount"]>,
    __resetQueryCount: () => c.call("__resetQueryCount", []) as ReturnType<Db["__resetQueryCount"]>,
    __dumpEntries: () => c.call("__dumpEntries", []) as ReturnType<Db["__dumpEntries"]>,
  };
}
