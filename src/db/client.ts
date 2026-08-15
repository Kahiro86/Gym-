// Main-thread half of the Worker boundary. Implements the `Db` interface
// so nothing above this module is aware a Worker exists at all.
import { reviveError } from "./errors.js";
import type { RpcRequest, RpcResponse } from "./protocol.js";
import type { Db, StorageInfo, VfsInfo } from "./types.js";

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
export function createDbClient(): Db {
  const bridge = new WorkerBridge();
  const cache = new Map<string, (...args: unknown[]) => Promise<unknown>>();
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
            const [vfs, p] = await Promise.all([
              bridge.call("__getVfsInfo", []) as Promise<VfsInfo>,
              persistence,
            ]);
            return { ...vfs, ...p };
          }
          : (...args: unknown[]) => bridge.call(prop, args);
        cache.set(prop, fn);
      }
      return fn;
    },
  });
}
