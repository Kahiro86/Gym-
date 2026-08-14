// The only place the sqlite3 module and its OPFS-backed database handle
// exist. Everything here runs off the main thread so queries never block
// rendering (spec §2). Communicates with client.ts via a small RPC protocol
// over postMessage — see types.ts's `Db` interface for the method surface
// this exposes.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { Repository, translateSqlError, __getQueryCount, __resetQueryCount, type SqlDb } from "./repository.js";
import { __setTestClock } from "./clock.js";
import { serializeError } from "./errors.js";

interface RpcRequest { id: number; method: string; args: unknown[] }
interface RpcSuccess { id: number; ok: true; result: unknown }
interface RpcFailure { id: number; ok: false; error: ReturnType<typeof serializeError> }

let repo: Repository | null = null;
let initError: string | null = null;

const ready = (async () => {
  try {
    const sqlite3 = await sqlite3InitModule();
    if (!("opfs" in sqlite3)) {
      // Per spec §2: this must be flagged loudly, never a silent downgrade.
      // Reasons this happens: not served with COOP/COEP, or a browser
      // without OPFS support.
      throw new Error(
        "OPFS is unavailable in this context — the page is not cross-origin " +
        "isolated (missing COOP/COEP headers) or the browser lacks OPFS support. " +
        "Refusing to silently fall back to a non-persistent store.",
      );
    }
    const db = new sqlite3.oo1.OpfsDb("/habits.sqlite3") as unknown as SqlDb;
    repo = new Repository(db);
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
  }
})();

function dispatch(method: string, args: unknown[]): unknown {
  if (method === "__setTestClock") { __setTestClock(args[0] as number | null); return undefined; }
  if (method === "__getQueryCount") return __getQueryCount();
  if (method === "__resetQueryCount") { __resetQueryCount(); return undefined; }

  if (!repo) throw new Error(initError || "database not initialized");
  const fn = (repo as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
  if (typeof fn !== "function") throw new Error(`unknown method: ${method}`);
  try {
    return fn.apply(repo, args);
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && typeof (err as { name: unknown }).name === "string"
      && ["ValidationError", "NotFoundError", "ConstraintError", "ConfirmationRequiredError", "IllegalStateChangeError"].includes((err as { name: string }).name)) {
      throw err;
    }
    translateSqlError(err);
  }
}

self.onmessage = async (ev: MessageEvent<RpcRequest>) => {
  const { id, method, args } = ev.data;
  await ready;
  try {
    const result = dispatch(method, args);
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies RpcSuccess);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: serializeError(err) } satisfies RpcFailure);
  }
};
