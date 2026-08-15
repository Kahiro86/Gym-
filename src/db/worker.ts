// The only place the sqlite3 module and the persistent database handle
// exist. Runs off the main thread so queries never block rendering.
//
// Storage is the OPFS SyncAccessHandle Pool VFS ("opfs-sahpool"). It is
// still SQLite — same schema, same SQL, same constraints, same
// transactions — only the bytes underneath are persisted differently.
// See STORAGE.md for why this VFS rather than the default "opfs" one.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  Repository, translateSqlError, __getStatementCount, __resetStatementCount, type SqlDb,
} from "./repository.js";
import { __setTestClock } from "./clock.js";
import { serializeError } from "./errors.js";
import type { RpcRequest, RpcResponse } from "./protocol.js";
import type { VfsInfo } from "./types.js";

let repo: Repository | null = null;
let initError: string | null = null;
let storage: VfsInfo | null = null;

const TYPED_ERRORS = new Set([
  "ValidationError", "NotFoundError", "ConstraintError",
  "ConfirmationRequiredError", "IllegalStateChangeError",
]);

/** Named so a second tab contends with the first, not with some other app. */
const WRITER_LOCK = "habits-db-writer";
const LOCK_WAIT_MS = 8000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Claims exclusive write access for this tab and holds it for the life of
 * the worker.
 *
 * The pool VFS takes exclusive sync access handles on its OPFS files, so
 * two tabs cannot both hold the database open. Without a lock the loser is
 * whichever tab happens to call second, and it fails with a raw handle
 * error. With one, the wait is explicit and the message is truthful.
 *
 * The wait matters as much as the exclusion: on a reload the outgoing
 * page's worker may still be alive for a moment, and failing instantly
 * would turn an ordinary refresh into an error card.
 */
function claimWriterLock(): Promise<void> {
  if (!("locks" in navigator)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(
        "Your habits are already open in another tab. Close it and reload — " +
        "only one tab can write to the database at a time.",
      )),
      LOCK_WAIT_MS,
    );
    navigator.locks
      .request(WRITER_LOCK, { mode: "exclusive" }, () => {
        clearTimeout(timer);
        resolve();
        // Never resolves: the lock is released when this worker dies.
        return new Promise<never>(() => {});
      })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Installs the pool VFS, retrying briefly.
 *
 * A reload can race the previous page's worker: its sync access handles
 * are released when it is torn down, but not necessarily before the new
 * worker asks for them. One retry loop is the difference between a
 * refresh that works and a refresh that shows an error card.
 */
async function installPool(sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>) {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Default name and directory on purpose: the VFS reports itself as
      // "opfs-sahpool", which is what the gate report has to be able to
      // show, and a renamed pool would only obscure that.
      return await sqlite3.installOpfsSAHPoolVfs({ initialCapacity: 6 });
    } catch (err) {
      last = err;
      await sleep(150 * (attempt + 1));
    }
  }
  const detail = last instanceof Error ? last.message : String(last);
  throw new Error(
    "Persistent storage is unavailable: the OPFS access-handle pool could not be opened " +
    `(${detail}). Refusing to fall back to an in-memory database, which would lose ` +
    "every habit on reload.",
  );
}

const ready = (async () => {
  try {
    await claimWriterLock();
    const sqlite3 = await sqlite3InitModule();
    const pool = await installPool(sqlite3);
    const db = new pool.OpfsSAHPoolDb("/habits.sqlite3") as unknown as SqlDb;
    repo = new Repository(db);
    storage = {
      // Read back from the running VFS rather than hardcoded, so the gate
      // report states what the database actually opened on.
      vfsName: pool.vfsName,
      files: pool.getFileNames(),
    };
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
  }
})();

function dispatch(method: string, args: unknown[]): unknown {
  switch (method) {
    case "__setTestClock": __setTestClock(args[0] as number | null); return undefined;
    case "__getStatementCount": return __getStatementCount();
    case "__resetStatementCount": __resetStatementCount(); return undefined;
    case "__getVfsInfo":
      if (!storage) throw new Error(initError ?? "database is not initialized");
      return storage;
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
