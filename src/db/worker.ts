// The only place the sqlite3 module and the OPFS-backed database handle
// exist. Runs off the main thread so queries never block rendering.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  Repository, translateSqlError, __getStatementCount, __resetStatementCount, type SqlDb,
} from "./repository.js";
import { __setTestClock } from "./clock.js";
import { serializeError } from "./errors.js";
import type { RpcRequest, RpcResponse } from "./protocol.js";

let repo: Repository | null = null;
let initError: string | null = null;

const TYPED_ERRORS = new Set([
  "ValidationError", "NotFoundError", "ConstraintError",
  "ConfirmationRequiredError", "IllegalStateChangeError",
]);

const ready = (async () => {
  try {
    const sqlite3 = await sqlite3InitModule();
    if (!("opfs" in sqlite3)) {
      // Spec §2 requires this be flagged loudly rather than silently
      // downgraded: without OPFS the data would not survive a reload,
      // and the user would not know until they lost it.
      throw new Error(
        "OPFS is unavailable: the page is not cross-origin isolated (COOP/COEP headers missing) " +
        "or this browser has no OPFS support. Refusing to fall back to a non-persistent store.",
      );
    }
    repo = new Repository(new sqlite3.oo1.OpfsDb("/habits.sqlite3") as unknown as SqlDb);
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
  }
})();

function dispatch(method: string, args: unknown[]): unknown {
  switch (method) {
    case "__setTestClock": __setTestClock(args[0] as number | null); return undefined;
    case "__getStatementCount": return __getStatementCount();
    case "__resetStatementCount": __resetStatementCount(); return undefined;
  }

  if (!repo) throw new Error(initError ?? "database is not initialized");
  const fn = (repo as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[method];
  if (typeof fn !== "function") throw new Error(`unknown method: ${method}`);

  try {
    return fn.apply(repo, args);
  } catch (err) {
    // Typed errors pass through untouched; anything else is a raw SQLite
    // failure that needs classifying before it reaches the caller.
    if (err instanceof Error && TYPED_ERRORS.has(err.name)) throw err;
    translateSqlError(err);
  }
}

self.onmessage = async (ev: MessageEvent<RpcRequest>) => {
  const { id, method, args } = ev.data;
  await ready;
  const post = (r: RpcResponse) => (self as unknown as Worker).postMessage(r);
  try {
    post({ id, ok: true, result: dispatch(method, args) });
  } catch (err) {
    post({ id, ok: false, error: serializeError(err) });
  }
};
