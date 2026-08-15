# Where the data lives

The app stores everything in SQLite compiled to WebAssembly, running in a
Web Worker. That has not changed since Layer 1 and is not up for debate:
the schema, the `UNIQUE(habit_id, date)` constraint, the foreign keys, the
CHECK constraints and the transactions are all real, enforced by the
database rather than by application code.

What did change is the **VFS** — the layer beneath SQLite that decides
where the bytes go.

## The VFS

| | Was | Now |
|---|---|---|
| VFS | `opfs` | `opfs-sahpool` |
| Needs `SharedArrayBuffer` | yes | no |
| Needs COOP/COEP headers | yes | **no** |
| Persistence | OPFS | OPFS |
| Schema, SQL, constraints | — | **unchanged** |

The default `opfs` VFS reaches OPFS through a second worker and blocks on
`Atomics.wait`, which requires `SharedArrayBuffer`, which requires the page
to be cross-origin isolated, which requires `Cross-Origin-Opener-Policy`
and `Cross-Origin-Embedder-Policy` response headers. **GitHub Pages cannot
send those headers.** An earlier build worked around it with a service
worker that added them to every response; that worked locally and failed on
a real phone, and the app correctly refused to open rather than falling
back to something that would lose data.

`opfs-sahpool` takes a different route to the same place. It opens a small
pool of OPFS sync access handles up front and uses them directly, so there
is no cross-worker call, no `Atomics.wait`, no `SharedArrayBuffer` and no
header requirement. It is a first-party VFS from the SQLite project, in the
same `@sqlite.org/sqlite-wasm` package already in use.

The service worker is gone. `index.html` unregisters any copy left over
from an earlier visit.

### Deviation from the Layer 1b spec

Spec §3.1 names `IDBBatchAtomicVFS`, an IndexedDB-backed VFS belonging to
the third-party `wa-sqlite` project. This build does not use it, for two
reasons.

1. It is not available here. This build runs on `@sqlite.org/sqlite-wasm`,
   the SQLite project's own distribution — substituted at the Layer 1 gate
   because the package published to npm as `wa-sqlite` is an unofficial,
   proprietary-licensed, year-stale republish. `IDBBatchAtomicVFS` ships
   with wa-sqlite and nothing else, so adopting it means swapping the
   SQLite distribution, which is the opposite of the small diff §3.1 asks
   for.
2. `opfs-sahpool` satisfies every requirement §3.1 actually states —
   SQLite untouched, schema untouched, queries untouched, constraints
   schema-enforced, no COOP/COEP, ships from the current host — and it is
   faster, because it is backed by OPFS rather than IndexedDB.

The trade-off runs the other way on availability: IndexedDB exists
everywhere, whereas `opfs-sahpool` needs OPFS with
`createSyncAccessHandle`. That is Chrome/Edge 108+, Safari 17+ and Firefox
111+ — which covers the target device and every current browser, but not,
for instance, Firefox in private browsing. When it is unavailable the app
says so and refuses to start, exactly as §3.1 requires; it never falls back
to an in-memory database.

## Multiple tabs

The pool VFS holds **exclusive** sync access handles, so two tabs cannot
have the database open at once. A Web Lock (`habits-db-writer`) makes that
explicit: the second tab waits up to 8 seconds for the first to release,
then reports "Your habits are already open in another tab" instead of
failing with a raw handle error.

The wait is not decoration. On an ordinary page reload the outgoing
worker may still be alive for a moment, and failing instantly would turn a
refresh into an error card. The VFS install is separately retried five
times with backoff for the same reason.

Note this differs from the spec's expectation for the IndexedDB VFS, where
a lock *serializes* concurrent writers. Here it *excludes* the second one.
The guarantee the spec asked for — no corruption — holds either way, but
the second tab is refused rather than queued.

## Eviction

`navigator.storage.persist()` is requested on first run and the answer is
recorded in `getStorageInfo()`. This is done on the main thread rather than
in the Worker alongside the rest of Layer 1, because `StorageManager.persist()`
is exposed on `Window` only — `persisted()` and `estimate()` work in a
Worker, the one call that matters does not.

A refusal is surfaced, not swallowed. Browsers commonly decline until the
app is installed or engaged with, and the user is entitled to know their
data is evictable.

## Verifying it, rather than believing it

`tests/acceptance/storage.mjs` runs against the built app on a static
server with no special headers, from a browser profile that has never been
used:

- the VFS name is **read back from the running database**, not asserted
  from source, because a silent fallback is the exact failure being guarded
  against
- planting a file where the pool needs a directory makes the install fail
  for a real reason, and the app is required to say so
- data written in one browser process is read back in a new one
- a second tab is refused, the first is unaffected, and the handover after
  the first closes is clean
- the page is confirmed **not** cross-origin isolated and **not** under a
  service worker, so passing proves the dependency is gone
