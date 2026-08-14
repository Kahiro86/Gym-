// Main-thread half of the Worker boundary. Implements the `Db` interface
// so nothing above this module is aware a Worker exists at all.
import { reviveError } from "./errors.js";
import type { RpcRequest, RpcResponse } from "./protocol.js";
import type { Db } from "./types.js";

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
        fn = (...args: unknown[]) => bridge.call(prop, args);
        cache.set(prop, fn);
      }
      return fn;
    },
  });
}
