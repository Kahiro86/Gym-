# Progress

Layers are built strictly bottom-up. A layer is not "done" until its gate
has been reported and cleared.

## Layer 1 — data — DONE
SQLite/WASM in a Web Worker. Schema, migrations, validation, typed errors,
the 4am day-start, the tri-state entry model, `UNIQUE(habit_id, date)`.
32/32 acceptance tests.

## Layer 2 — logic — DONE
Scores, streaks, trends, history, heatmap, and the three screens' view
models. Pure core plus a thin async facade, so the arithmetic is testable
without a browser. 188 unit tests, 17 integration tests.

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
| Layer 1 acceptance | 32/32 |
| Layer 2 integration | 17/17 |
| Layer 2 unit | 198/198 |
| Storage (§9.2) | 6/6 |
| Sync (§9.2-9.3) | 11/11 |
| Editor and Screen 1 | 21/21 |
| Supabase (§9.4) | not run — no project |

Every Layer 2 source and test that existed before Layer 1b is byte-identical
to what it was then — that is §9.1's requirement, and it holds. Layer 2 has
since *gained* `editor.ts` and its 28 unit tests, which is an addition for
the habit editor, not a change to anything Layer 1b touched.

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
   tests and 17 integration tests; the suite has 188 and 17. The tests
   were rewritten during the Opus 5 rebuild, and the editor added 28
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
9. **A scheduled day with nothing logged shows a faint dot.** Loop leaves
   it entirely blank, which makes it indistinguishable from a day the
   habit was never due and gives no hint that the cell is tappable. The
   dot is far dimmer than today's gold ring, so the invitation to log
   today still reads first.
10. **The filter and overflow buttons do something.** The spec draws both
    and defines neither. Rendering a control that does nothing is worse
    than not drawing it, and they were reported as broken.
