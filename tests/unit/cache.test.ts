// Layer 2b §6. The acceptance suite proves the cache never serves a
// stale answer in the running app; it cannot force the one interleaving
// that would break it, because the Worker's queue decides the order.
//
// Here the order is chosen. `compute` is held open on purpose and the
// write counter is moved while it is suspended, which is precisely the
// window the re-check inside memo() exists for.
import { describe, expect, it } from "vitest";
import { LogicCache } from "../../src/logic/cache.js";
import type { Db } from "../../src/db/types.js";

/** A Db that answers exactly one question, with a counter under test control. */
function fakeDb(counters: Record<string, number>) {
  let reads = 0;
  const db = {
    getWriteCounters: async () => { reads++; return { ...counters }; },
  } as unknown as Db;
  return { db, counters, reads: () => reads };
}

/** A promise plus the handle to settle it later. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("LogicCache", () => {
  it("serves a second identical read from memory", async () => {
    const { db } = fakeDb({ h1: 1 });
    const cache = new LogicCache();
    let computed = 0;
    const compute = async () => { computed++; return 7; };

    expect(await cache.memo(db, "h1", "getCurrentStreak", [], compute)).toBe(7);
    expect(await cache.memo(db, "h1", "getCurrentStreak", [], compute)).toBe(7);
    expect(computed).toBe(1);
    expect(cache.stats().hits).toBe(1);
  });

  it("misses when the habit's write counter has moved", async () => {
    const state = { h1: 1 };
    const { db } = fakeDb(state);
    const cache = new LogicCache();

    expect(await cache.memo(db, "h1", "getCurrentStreak", [], async () => 2)).toBe(2);
    state.h1 = 2;
    expect(await cache.memo(db, "h1", "getCurrentStreak", [], async () => 3)).toBe(3);
  });

  it("keeps another habit's entry when one habit is written to", async () => {
    const state = { h1: 1, h2: 1 };
    const { db } = fakeDb(state);
    const cache = new LogicCache();

    await cache.memo(db, "h1", "getCurrentStreak", [], async () => 5);
    await cache.memo(db, "h2", "getCurrentStreak", [], async () => 9);
    state.h1 = 2;

    let recomputed = false;
    expect(await cache.memo(db, "h2", "getCurrentStreak", [], async () => {
      recomputed = true;
      return 0;
    })).toBe(9);
    expect(recomputed).toBe(false);
  });

  it("distinguishes functions and arguments", async () => {
    const { db } = fakeDb({ h1: 1 });
    const cache = new LogicCache();
    await cache.memo(db, "h1", "getScore", ["week"], async () => 40);
    expect(await cache.memo(db, "h1", "getScore", ["month"], async () => 80)).toBe(80);
    expect(await cache.memo(db, "h1", "getHistory", ["week"], async () => 1)).toBe(1);
    expect(await cache.memo(db, "h1", "getScore", ["week"], async () => -1)).toBe(40);
  });

  it("does NOT store a value computed across a write", async () => {
    // The interleaving the acceptance suite cannot force: the counter
    // moves while compute() is suspended, so the value in flight was
    // read from data that no longer exists.
    const state = { h1: 1 };
    const { db } = fakeDb(state);
    const cache = new LogicCache();
    const gate = deferred<number>();

    const inFlight = cache.memo(db, "h1", "getCurrentStreak", [], () => gate.promise);
    state.h1 = 2;            // a write lands
    gate.resolve(2);         // the stale answer arrives
    expect(await inFlight).toBe(2);

    // Nothing may be served from that computation, at either version.
    let recomputed = false;
    const next = await cache.memo(db, "h1", "getCurrentStreak", [], async () => {
      recomputed = true;
      return 3;
    });
    expect(recomputed).toBe(true);
    expect(next).toBe(3);
    // And it must not have been filed under the OLD version either,
    // where a later read at that version would find it.
    state.h1 = 1;
    let recomputedAgain = false;
    expect(await cache.memo(db, "h1", "getCurrentStreak", [], async () => {
      recomputedAgain = true;
      return 99;
    })).toBe(99);
    expect(recomputedAgain).toBe(true);
  });

  it("drops everything when the counters cannot be read", async () => {
    // Correctness beats speed: an unreadable counter means no value can
    // be trusted, so the cache empties rather than guessing.
    const state = { h1: 1 };
    let fail = false;
    const db = {
      getWriteCounters: async () => {
        if (fail) throw new Error("worker gone");
        return { ...state };
      },
    } as unknown as Db;
    const cache = new LogicCache();

    await cache.memo(db, "h1", "getCurrentStreak", [], async () => 4);
    expect(cache.stats().size).toBe(1);

    fail = true;
    let recomputed = false;
    expect(await cache.memo(db, "h1", "getCurrentStreak", [], async () => {
      recomputed = true;
      return 6;
    })).toBe(6);
    expect(recomputed).toBe(true);
  });

  it("clear() empties the store and the counters it was trusting", async () => {
    const { db } = fakeDb({ h1: 1 });
    const cache = new LogicCache();
    await cache.memo(db, "h1", "getCurrentStreak", [], async () => 4);
    cache.clear();
    expect(cache.stats().size).toBe(0);

    let recomputed = false;
    await cache.memo(db, "h1", "getCurrentStreak", [], async () => { recomputed = true; return 4; });
    expect(recomputed).toBe(true);
  });

  it("coalesces concurrent counter refreshes into one read", async () => {
    const { db, reads } = fakeDb({ h1: 1 });
    const cache = new LogicCache();
    await Promise.all([
      cache.memo(db, "h1", "a", [], async () => 1),
      cache.memo(db, "h1", "b", [], async () => 2),
      cache.memo(db, "h1", "c", [], async () => 3),
    ]);
    // Three reads starting together share one refresh; each then
    // re-checks after its own compute.
    expect(reads()).toBeLessThan(6);
  });

  it("bounds its size, so a long session cannot grow without limit", async () => {
    const { db } = fakeDb({ h1: 1 });
    const cache = new LogicCache();
    for (let i = 0; i < 600; i++) {
      await cache.memo(db, "h1", "getHeatmapData", [`2026-${String((i % 12) + 1)}-${i}`], async () => i);
    }
    expect(cache.stats().size).toBeLessThanOrEqual(500);
  });
});
