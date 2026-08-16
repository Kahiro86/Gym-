# Progress

Layers are built strictly bottom-up. A layer is not "done" until its gate
has been reported and cleared.

## Layer 1 — data — DONE
SQLite/WASM in a Web Worker. Schema, migrations, validation, typed errors,
the 4am day-start, the tri-state entry model, `UNIQUE(habit_id, date)`.
32/32 acceptance tests (spec tests 1-31).

The revised data spec added tests 32-60 — concurrency, volume and query
plans, hostile input, calendar edge cases, migration robustness,
durability. 32/32 in `tests/acceptance/layer1-extended.mjs`. Eight real
bugs were found and fixed getting there; see below.

## Layer 2 — logic — DONE
Scores, streaks, trends, history, heatmap, and the three screens' view
models. Pure core plus a thin async facade, so the arithmetic is testable
without a browser. Layer 1 and Layer 2 together have 245 unit tests; Layer 2
has 17 integration tests.

## Layer 3 — UI
- Screen 1 (list) — DONE
- Screen 2 (detail) — DONE
- Screen 3 (calendar) — DONE
- Habit editor — DONE. **Not in the build spec**, which describes three
  read screens and no way to create a habit, so the "+" had nothing
  behind it and the app could only ever be empty. Create, edit, archive
  and delete, reached from the "+", the empty state and the detail
  screen's pencil.
- Screen 1's filter and overflow menus — DONE. Also not in the spec,
  which draws both icons but defines no behaviour. Filter: show archived,
  hide done today. Overflow: new group, the day-start hour, and where the
  data is stored.
- Deployed to GitHub Pages, gated on the full test suite.

## Layer 1b — sync — IN PROGRESS

### Done
- **§3.1 VFS swap.** `opfs-sahpool` instead of the default `opfs` VFS. No
  SharedArrayBuffer, no COOP/COEP, so the app runs on GitHub Pages. SQLite,
  the schema, every query and every constraint unchanged. See STORAGE.md,
  including why this rather than the spec's `IDBBatchAtomicVFS`.
- **Web Lock + persistence.** A second tab is refused with a truthful
  message rather than a raw handle error; `navigator.storage.persist()` is
  requested on first run and its answer surfaced.
- **§4 schema.** Migration 2 adds `user_id`, `deleted_at` and
  `sync_status` to all three tables, creates `sync_queue`, seeds
  `device_id`, and backfills the queue for rows that predate it.
- **§6 tombstones.** `deleteEntry`, `deleteHabit` and `deleteRoutine` set
  `deleted_at`. Every read filters it out, so Layer 2's contract is
  unchanged. Purge at 90 days, only for rows the server has acknowledged.
- **§7 sync engine.** Push drains the queue in order with per-row
  outcomes and exponential backoff; pull is incremental on `last_pull_at`;
  conflicts resolve last-write-wins on `updated_at` with the server
  winning ties, never merging. Triggers on start, reconnect, mutation
  (debounced 2s) and a 5-minute timer.
- **§7.5** `SyncConflictError`.
- **§8** `getSyncState()` and `getPendingCount()`, and nothing else.
- **§5 Postgres.** `supabase/schema.sql` — schema parity, `date` as TEXT,
  RLS forced on from the start, an `updated_at` trigger so a client cannot
  win a conflict by lying, the `v_daily_completions` view for Kahiro's
  reads and the `habit_log_entry` RPC for its writes.

### Not done
- **Running `supabase/schema.sql` against the real project.** There are no
  credentials in this environment. The SQL is reviewed, not executed.
- **§9.4 tests 17-22** — RLS with two accounts, `user_id` spoofing, the
  Kahiro view, direct-write denial, RPC validation, RPC round-trip. All
  six need real Postgres and two real accounts. Running them against a
  fake would prove nothing about the claim being made.
- **Signing in.** The engine reads its URL and key from the build and
  needs an access token and user id to become active. Until then it is
  inert and `getSyncState()` reports `offline`, which is the truth: there
  is nowhere for the queue to drain to. Local writes keep working and keep
  queueing.

### Test results

| Suite | Result |
|---|---|
| Layer 1 acceptance (1-31) | 32/32 |
| Layer 1 extended (32-60) | 32/32 |
| Layer 2 integration | 17/17 |
| Layer 2 and Layer 1 unit | 245/245 |
| Storage (§9.2) | 6/6 |
| Sync (§9.2-9.3) | 11/11 |
| Editor and Screen 1 | 26/26 |
| Supabase (§9.4) | not run — no project |

Every Layer 2 source and test that existed before Layer 1b is byte-identical
to what it was then — that is §9.1's requirement, and it holds. Layer 2 has
since *gained* `editor.ts` and 38 unit tests, which is an addition for
the habit editor, not a change to anything Layer 1b touched.

## Bugs the revised Layer 1 spec found

Each of these was live, and none was caught by the previous 31 tests.

1. **Dates were validated by regex only.** `2026-02-30`, `2026-13-01`,
   `2027-02-29` and `2026-04-31` all matched `^\d{4}-\d{2}-\d{2}$` and
   were stored. Once written, no later check could say what the user
   meant. `src/db/dates.ts` now checks the real calendar, including the
   century rule — `2100-02-29` is rejected, `2000-02-29` is not.
2. **`Infinity` was storable as an entry value.** Only `NaN` was checked.
   One stored infinity poisons every sum computed from it.
3. **Negative values were storable.** They have no meaning in this model:
   a day not done is `0`, an unlogged day has no row.
4. **`transaction(fn)` was missing entirely**, though spec §5 requires
   it. Multi-write operations had no way to be atomic.
5. **Transactions could not nest.** Adding `runTransaction` exposed it
   immediately: every mutation already opens its own transaction for the
   sync queue, and SQLite refuses a nested `BEGIN`. Inner writes now join
   the outer transaction, which is also the correct semantics.
6. **A newer database would be opened and written by older code.** Now
   refused, with both version numbers in the message.
7. **Quota failures surfaced untyped**, so the UI could not tell "storage
   is full" from a constraint violation. Now `QuotaExceededError`.
8. **An evicted database was indistinguishable from a new one.** Someone
   whose browser cleared their history would have been shown "No habits
   yet". A marker outside the database now makes the two distinguishable,
   and the list says so plainly.

## Next
Supabase provisioning, then the remaining §9.4 tests.

---

## Deviations from the specs, logged rather than absorbed

1. **`@sqlite.org/sqlite-wasm` instead of `wa-sqlite`** (Layer 1 gate).
   The npm package named `wa-sqlite` is an unofficial, proprietary-licensed
   republish, a year behind. This is the SQLite project's own build.
2. **`opfs-sahpool` instead of `IDBBatchAtomicVFS`** (Layer 1b §3.1).
   `IDBBatchAtomicVFS` belongs to wa-sqlite and is not available here;
   adopting it would mean swapping SQLite distributions, the opposite of
   the small diff §3.1 asks for. The pool VFS meets every stated
   requirement and is faster. Trade-off: it needs OPFS with
   `createSyncAccessHandle` (Chrome 108+, Safari 17+, Firefox 111+),
   where IndexedDB would have been universal. Full reasoning in STORAGE.md.
3. **The Web Lock excludes a second tab rather than serializing it**
   (§3.1). The pool VFS holds exclusive handles, so two tabs genuinely
   cannot both write. The no-corruption guarantee holds; the second tab is
   refused with an explanation instead of queued.
4. **`user_id` is nullable in the local schema**, NOT NULL in Postgres
   (§4.1). There is no session before first sign-in, and a placeholder id
   would be fabricated data.
5. **Layer 1 acceptance tests 30 and 31 were edited.** They asserted
   `schema_version === "1"`, which §4's migration 2 makes false by design;
   a hardcoded 1 asserts the schema never advances. They now assert the
   latest version and additionally check `device_id` and `last_pull_at`.
   No other test in any suite was touched. This is the only exception to
   §9.1's "unmodified", and it is a conflict between §9.1 and §4 rather
   than a weakened test.
6. **Test counts differ from the spec's.** §9.1 cites 138 Layer 2 unit
   tests and 17 integration tests; the suite has 198 and 17. The tests
   were rewritten during the Opus 5 rebuild, and the editor and Screen 1's
   menus added 38
   more. The binding requirement — the pre-Layer-1b Layer 2 tests pass
   with zero edits to Layer 2 — holds.
7. **A habit editor was added, which no spec describes.** The build spec
   defines three read screens; without a way to create a habit the app
   is permanently empty, which is what shipped. Layer 2 gained
   `editor.ts` (draft shape, validation, write passthroughs) so the new
   screen still imports only from Layer 2.
8. **CalendarScreen called `db.deleteEntry` directly**, bypassing Layer 2
   — a boundary violation from the Screen 3 work. It now goes through
   Layer 2's `deleteEntry`.
9. **A scheduled day that ended without being done shows a dash.** Loop
   leaves it entirely blank, which is indistinguishable from a day the
   habit was never due, and reads as though the cell is still waiting
   after the day has closed. Layer 2 gained a `lapsed` cell state for
   exactly this; `blank` now means only "not scheduled". Storage is
   unchanged — there is still no row, and an explicit miss (value 0) is
   still a separate state shown as an x.
10. **The filter and overflow buttons do something.** The spec draws both
    and defines neither. Rendering a control that does nothing is worse
    than not drawing it, and they were reported as broken.
11. **`transaction(fn)` is `runTransaction(ops)`** (§5). A callback
    cannot cross the Worker boundary, and passing a live transaction
    handle to the main thread would hold it open across a postMessage
    round trip — long enough to block another tab. Operations are named
    instead, and only repository writes are transactable.
12. **Date bounds are deliberately unbounded** (§9.10 test 52). 1970 and
    2099 both store; lexicographic order stays chronological for any
    four-digit year, so no limit is needed and any chosen one would be
    arbitrary.
13. **Tapping a measurable habit's cell asks for the amount in place**,
    rather than opening the detail screen. The original reasoning — a tap
    cannot invent an amount — was right, but navigating away meant the
    app's central gesture did nothing on a measurable habit. Only the
    habit's name navigates now.
