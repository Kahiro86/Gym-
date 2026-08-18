// Main-thread half of the Worker boundary. Implements the `Db` interface
// so nothing above this module is aware a Worker exists at all.
import { reviveError } from "./errors.js";
// Even a marker timestamp goes through the clock. Spec §3 allows exactly
// one no-argument `new Date()` in the codebase, and an acceptance test
// enforces it — a second one here would be the crack the rule exists to
// prevent, however innocent this particular use is.
import { now } from "./clock.js";
import type { RpcRequest, RpcResponse } from "./protocol.js";
import type { Db, EvictionReport, RowCounts, StorageInfo, VfsInfo } from "./types.js";

/**
 * A record of what this browser last held, kept OUTSIDE the database.
 *
 * Spec §9.12 test 59. If the browser evicts the origin's storage, the
 * database reopens perfectly — and empty. Nothing inside it can say
 * whether that is a new install or a year of history erased, and showing
 * "no habits yet" to someone who had forty is a lie they cannot detect.
 *
 * localStorage is not durable either, but it is evicted on a different
 * schedule from OPFS, so the two disagreeing is itself the signal. When
 * both are gone the app is genuinely indistinguishable from new, and
 * says nothing rather than guessing.
 */
const MARKER_KEY = "habits:last-known";

/** Called when the Worker reports that a sync pull applied rows. */
const pullListeners = new Set<() => void>();

export function onSyncPull(fn: () => void): () => void {
  pullListeners.add(fn);
  return () => pullListeners.delete(fn);
}

interface Marker { habits: number; entries: number; at: string; persisted: boolean }

function readMarker(): Marker | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<Marker>;
    if (typeof m?.habits !== "number" || typeof m?.at !== "string") return null;
    return { habits: m.habits, entries: m.entries ?? 0, at: m.at, persisted: !!m.persisted };
  } catch {
    return null; // private mode, or someone else's key. Not worth failing over.
  }
}

function writeMarker(m: Marker): void {
  try { localStorage.setItem(MARKER_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

/**
 * Asks the browser not to evict this origin's storage, once per page.
 *
 * The local database is the source of truth between syncs, so eviction is
 * data loss rather than a cache miss. This lives on the main thread and
 * not beside the rest of Layer 1 in the Worker for a boring reason:
 * `StorageManager.persist()` is exposed on Window only. `persisted()` and
 * `estimate()` work in a Worker; the one call that matters does not.
 *
 * A refusal is recorded, not hidden — the user is entitled to know their
 * data is evictable.
 */
const persistence: Promise<{ persisted: boolean; persistRequested: boolean }> = (async () => {
  const s = navigator.storage;
  if (!s?.persisted) return { persisted: false, persistRequested: false };
  if (await s.persisted()) return { persisted: true, persistRequested: false };
  if (!s.persist) return { persisted: false, persistRequested: false };
  return { persisted: await s.persist(), persistRequested: true };
})();

class WorkerBridge {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<RpcResponse>) => {
      const msg = ev.data;
      // id -1 is not a reply to anything: it is the Worker announcing
      // that a sync pull landed. Layer 2 subscribes; Layer 1 stays
      // unaware that anyone is listening.
      if (msg.id === -1) {
        if (msg.ok) for (const fn of pullListeners) fn();
        return;
      }
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.ok) slot.resolve(msg.result);
      else slot.reject(reviveError(msg.error));
    };
    // A worker that dies (OOM, uncaught init failure) would otherwise
    // leave every caller hanging forever — fail them loudly instead.
    this.worker.onerror = (ev) => this.rejectAll(new Error(`database worker crashed: ${ev.message}`));
  }

  private rejectAll(err: Error): void {
    for (const [, slot] of this.pending) slot.reject(err);
    this.pending.clear();
  }

  call(method: string, args: unknown[]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args } satisfies RpcRequest);
    });
  }
}

/**
 * Every `Db` method is the same one-line forward, so it is generated
 * rather than hand-written: a Proxy cannot fall out of sync with the
 * interface the way ~30 copy-pasted wrappers eventually would.
 * Type safety is unaffected — callers see the `Db` interface.
 */
/** Every method that changes data, so the marker can follow the truth. */
const MUTATIONS = new Set([
  "createRoutine", "updateRoutine", "archiveRoutine", "deleteRoutine", "reorderRoutines",
  "createHabit", "updateHabit", "archiveHabit", "unarchiveHabit", "deleteHabit", "reorderHabits",
  "setEntry", "deleteEntry", "runTransaction",
]);

export function createDbClient(): Db {
  const bridge = new WorkerBridge();
  const cache = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  let markerTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Refreshes the marker after writes, coalesced. A stale marker is
   * worse than none: it would report an eviction that never happened, or
   * miss one that did.
   */
  const refreshMarker = () => {
    if (markerTimer) clearTimeout(markerTimer);
    markerTimer = setTimeout(async () => {
      markerTimer = null;
      try {
        const counts = await bridge.call("__rowCounts", []) as RowCounts;
        const p = await persistence;
        writeMarker({ ...counts, at: now().toISOString(), persisted: p.persisted });
      } catch { /* the database is already reporting its own failure */ }
    }, 1500);
  };

  return new Proxy({} as Db, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      let fn = cache.get(prop);
      if (!fn) {
        // The one method whose answer is split across both sides of the
        // boundary: the VFS knows where the bytes went, only the main
        // thread can ask whether they are safe from eviction.
        fn = prop === "getStorageInfo"
          ? async (): Promise<StorageInfo> => {
            const [vfs, p, counts] = await Promise.all([
              bridge.call("__getVfsInfo", []) as Promise<VfsInfo>,
              persistence,
              bridge.call("__rowCounts", []) as Promise<RowCounts>,
            ]);
            const marker = readMarker();
            // Only an emptied database is suspicious. A database with
            // rows in it has not been evicted, whatever the marker says.
            const evicted: EvictionReport | null =
              marker && marker.habits > 0 && counts.habits === 0 && counts.entries === 0
                ? { lastKnownHabits: marker.habits, lastKnownEntries: marker.entries, lastSeenAt: marker.at }
                : null;
            if (!evicted) {
              writeMarker({ ...counts, at: now().toISOString(), persisted: p.persisted });
            }
            return { ...vfs, ...p, counts, evicted };
          }
          : async (...args: unknown[]) => {
            const result = await bridge.call(prop, args);
            if (MUTATIONS.has(prop)) refreshMarker();
            return result;
          };
        cache.set(prop, fn);
      }
      return fn;
    },
  });
}
