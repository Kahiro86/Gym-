// Layer 1b §7 — the sync engine.
//
// Runs inside the Worker, beside the database, because a push has to read
// the queue and record its outcome in the same place the mutation was
// written. Nothing above Layer 1 imports this module: Layer 2 does not
// know it exists, and the UI sees only getSyncState() and
// getPendingCount() (§8).
//
// The local database is authoritative for the UI at all times. A write
// returns as soon as it is durable locally; reaching the server happens
// afterwards and never blocks a tap (§3.2).
import { now } from "./clock.js";
import { SyncConflictError } from "./errors.js";
import type { Repository, SyncQueueItem, SyncTable } from "./repository.js";
import type { SyncRunResult, SyncState } from "./types.js";

/** Where the server is and who we are to it. */
export interface SyncConfig {
  url: string;
  apiKey: string;
  /** The signed-in user's access token. Without one, sync stays off. */
  accessToken: string;
  userId: string;
  /** Postgres schema the habit app owns (§5.3). */
  schema?: string;
}

const TABLES: SyncTable[] = ["routines", "habits", "entries"];
const BATCH = 100;
/** Tried, in order, on repeated failure of the same queue item. */
const BACKOFF_MS = [0, 2_000, 8_000, 30_000, 120_000, 600_000];

const stamp = (): string => now().toISOString();

/** Reads config from the build. Absent values mean sync is not set up. */
export function configFromEnv(env: Record<string, string | undefined>): SyncConfig | null {
  const url = env.VITE_SUPABASE_URL;
  const apiKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !apiKey) return null;
  // accessToken and userId arrive with a session; until then the engine
  // is constructed but inert, which getSyncState() reports as "offline".
  return { url, apiKey, accessToken: "", userId: "", schema: env.VITE_SUPABASE_SCHEMA || "habits" };
}

export class SyncEngine {
  private readonly repo: Repository;
  private config: SyncConfig | null;
  private lastError: string | null = null;
  private running: Promise<SyncRunResult> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(repo: Repository, config: SyncConfig | null) {
    this.repo = repo;
    this.config = config;
  }

  setConfig(config: SyncConfig | null): void {
    this.config = config;
  }

  private get active(): boolean {
    return !!this.config?.url && !!this.config.accessToken && !!this.config.userId;
  }

  private get online(): boolean {
    // navigator.onLine is a weak signal — it reports the link, not
    // reachability — so it is used only to skip obviously-doomed attempts,
    // never to decide that a completed request failed.
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  // ── §7.4 triggers ───────────────────────────────────────────────────
  /** App start, reconnect, and a 5-minute tick while online. */
  start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => { if (this.online) void this.run(); }, 5 * 60_000);
    if (typeof addEventListener === "function") {
      addEventListener("online", () => void this.run());
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  /** Called after every local mutation, coalesced so a burst is one push. */
  nudge(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debounce = null; void this.run(); }, 2_000);
  }

  // ── §8: the only two facts anything upstairs may have ───────────────
  getSyncState(): SyncState {
    if (this.repo.getConflictCount() > 0) return "error";
    if (!this.active || !this.online) return "offline";
    if (this.lastError) return "error";
    return this.repo.getPendingCount() > 0 ? "pending" : "synced";
  }

  getPendingCount(): number {
    return this.repo.getPendingCount();
  }

  // ── The cycle ───────────────────────────────────────────────────────
  /** One push-then-pull cycle. Concurrent calls share the run in flight. */
  run(): Promise<SyncRunResult> {
    if (this.running) return this.running;
    this.running = this.cycle().finally(() => { this.running = null; });
    return this.running;
  }

  private async cycle(): Promise<SyncRunResult> {
    const result: SyncRunResult = { pushed: 0, pulled: 0, conflicts: 0, error: null };
    if (!this.active) {
      result.error = "sync is not configured";
      return result;
    }
    try {
      const push = await this.push();
      result.pushed = push.pushed;
      result.conflicts = push.conflicts;
      // A pull on top of an incomplete push would apply server state over
      // local changes that have not been sent yet, and last-write-wins
      // would then discard them. Pull only from a drained queue.
      if (this.repo.getPendingCount() === 0) {
        result.pulled = await this.pull();
        // §6. Only reached on a clean cycle, and purgeTombstones itself
        // touches nothing the server has not acknowledged — an unsynced
        // tombstone dropped here would let its row return on the next pull.
        const cutoff = new Date(now().getTime() - 90 * 86_400_000).toISOString();
        this.repo.purgeTombstones(cutoff);
      }
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      result.error = this.lastError;
    }
    return result;
  }

  // ── §7.1 push ───────────────────────────────────────────────────────
  private async push(): Promise<{ pushed: number; conflicts: number }> {
    let pushed = 0;
    let conflicts = 0;

    for (;;) {
      const batch = this.repo.peekSyncQueue(BATCH).filter((item) => this.dueNow(item));
      if (!batch.length) break;

      // One item at a time within a batch. Batching the HTTP call would
      // be faster, but §7.1 requires one failure not to block unrelated
      // rows, and a single request cannot report per-row outcomes.
      let progressed = false;
      for (const item of batch) {
        const outcome = await this.pushOne(item);
        if (outcome === "ok") { pushed++; progressed = true; }
        else if (outcome === "conflict") { conflicts++; progressed = true; }
        else return { pushed, conflicts }; // network down: stop, keep the queue
      }
      if (!progressed) break;
    }
    return { pushed, conflicts };
  }

  /** Exponential backoff, so a rejected row does not spin (§7.1). */
  private dueNow(item: SyncQueueItem): boolean {
    if (item.attempts === 0) return true;
    const wait = BACKOFF_MS[Math.min(item.attempts, BACKOFF_MS.length - 1)];
    const last = Date.parse(item.createdAt);
    return Number.isNaN(last) || now().getTime() - last >= wait;
  }

  private async pushOne(item: SyncQueueItem): Promise<"ok" | "conflict" | "offline"> {
    // A delete is pushed as an upsert of the tombstoned row, not as a
    // DELETE: the server has to keep the tombstone so other devices learn
    // about it (§6). The operation is recorded for clarity, not to
    // choose a different verb.
    const body = { ...item.payload, user_id: this.config!.userId };
    let res: Response;
    try {
      res = await this.request("POST", item.tableName, {
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([body]),
      });
    } catch {
      return "offline"; // fetch itself failed: no network, nothing learned
    }

    if (res.ok) {
      this.repo.resolveSyncItem(item.id, item.tableName, item.recordId);
      return "ok";
    }

    const text = await res.text().catch(() => "");
    // 4xx is the server refusing the data — a validation failure or an
    // RLS denial. Retrying cannot fix it, so it is a conflict a human has
    // to see, never something to drop (§7.1, non-negotiable #6).
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      this.repo.failSyncItem(item.id, `${res.status} ${text}`.trim().slice(0, 500), "conflict");
      return "conflict";
    }
    this.repo.failSyncItem(item.id, `${res.status} ${text}`.trim().slice(0, 500), "retry");
    return "offline";
  }

  // ── §7.2 pull ───────────────────────────────────────────────────────
  private async pull(): Promise<number> {
    const since = this.repo.getMeta("last_pull_at");
    const highWater = stamp();
    let applied = 0;

    // Parents first: an entry whose habit has not arrived yet would fail
    // the foreign key.
    for (const table of TABLES) {
      const query = since
        ? `?updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc`
        : `?order=updated_at.asc`;
      const res = await this.request("GET", `${table}${query}`);
      if (!res.ok) throw new Error(`pull ${table}: ${res.status} ${await res.text().catch(() => "")}`);
      const rows = (await res.json()) as Record<string, unknown>[];
      applied += this.applyRows(table, rows);
    }

    // Advanced only after every table applied cleanly. A throw above
    // leaves it where it was, so the next pull re-fetches rather than
    // skipping rows that never landed (§9.3 test 12).
    this.repo.setMeta("last_pull_at", highWater);
    return applied;
  }

  /** §7.3 — last-write-wins on updated_at, per row, never merged. */
  private applyRows(table: SyncTable, rows: Record<string, unknown>[]): number {
    let applied = 0;
    for (const row of rows) {
      const id = String(row.id ?? "");
      if (!id) continue;
      const local = this.repo.getRawRow(table, id);
      if (local) {
        const mine = String(local.updated_at ?? "");
        const theirs = String(row.updated_at ?? "");
        // Strictly later wins; an exact tie goes to the server, so two
        // devices reach the same answer without talking to each other.
        if (mine > theirs) continue;
      }
      this.repo.applyRemoteRow(table, row);
      applied++;
    }
    return applied;
  }

  private request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const c = this.config!;
    return fetch(`${c.url}/rest/v1/${path}`, {
      ...init,
      method,
      headers: {
        apikey: c.apiKey,
        Authorization: `Bearer ${c.accessToken}`,
        "Content-Type": "application/json",
        "Accept-Profile": c.schema ?? "habits",
        "Content-Profile": c.schema ?? "habits",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }
}

export { SyncConflictError };
