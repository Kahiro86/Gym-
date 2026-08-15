// A minimal stand-in for Supabase's PostgREST endpoint, enough to drive
// the sync engine honestly.
//
// This is NOT a substitute for testing against the real project — §9.4's
// RLS, view and RPC tests need genuine Postgres and two real accounts.
// What it is for is the half of §9.3 that is about the *client*: does the
// queue drain in order, does last-write-wins pick the right side, does a
// tombstone stay dead, does last_pull_at hold its ground when an apply
// fails partway. Those are engine behaviours, and they are only provable
// against a server that can be told to misbehave on demand.
//
// Deliberately implemented as tables of plain rows with an updated_at
// filter, which is exactly the contract the engine depends on.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SUPABASE_PORT || 5299);

/** user_id → { routines, habits, entries } */
const store = new Map();
/** Test controls, set through the /__control endpoint. */
let failNext = null; // { table, status, body }
let offline = false;
const log = [];

function tablesFor(userId) {
  if (!store.has(userId)) store.set(userId, { routines: [], habits: [], entries: [] });
  return store.get(userId);
}

function userFrom(req) {
  // The fake accepts "Bearer <user-id>" so a test can be two devices of
  // one user, or two different users, without an auth server.
  const auth = req.headers.authorization || "";
  return auth.replace(/^Bearer\s+/i, "") || null;
}

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => { s += c; });
    req.on("end", () => resolve(s ? JSON.parse(s) : null));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  // ── Test controls ─────────────────────────────────────────────────
  if (url.pathname === "/__control") {
    const body = await readBody(req);
    if (body?.reset) { store.clear(); failNext = null; offline = false; log.length = 0; }
    if (body?.failNext !== undefined) failNext = body.failNext;
    if (body?.offline !== undefined) offline = body.offline;
    if (body?.seed) {
      for (const { userId, table, rows } of body.seed) tablesFor(userId)[table].push(...rows);
    }
    return send(res, 200, { ok: true, log, store: Object.fromEntries(store) });
  }

  if (offline) { res.destroy(); return; } // as unreachable as a dead network

  const m = url.pathname.match(/^\/rest\/v1\/(routines|habits|entries)$/);
  if (!m) return send(res, 404, { message: "no such endpoint" });
  const table = m[1];

  const userId = userFrom(req);
  if (!userId) return send(res, 401, { message: "no bearer token" });

  if (failNext && failNext.table === table) {
    const f = failNext;
    failNext = f.sticky ? failNext : null;
    log.push({ method: req.method, table, forcedStatus: f.status });
    return send(res, f.status, { message: f.body || "forced failure" });
  }

  const rows = tablesFor(userId)[table];

  if (req.method === "GET") {
    // Only the one filter the engine uses: updated_at=gt.<iso>
    const filter = url.searchParams.get("updated_at");
    let out = rows;
    if (filter?.startsWith("gt.")) {
      const since = filter.slice(3);
      out = rows.filter((r) => String(r.updated_at) > since);
    }
    out = [...out].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
    log.push({ method: "GET", table, returned: out.length });
    return send(res, 200, out);
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : [body];
    for (const row of incoming) {
      if (!row.id) return send(res, 400, { message: "row has no id" });
      // Stands in for RLS + the CHECK constraints: a row claiming another
      // user, or missing something the schema requires, is refused rather
      // than stored.
      if (row.user_id && row.user_id !== userId) {
        return send(res, 403, { message: "row violates row-level security policy" });
      }
      if (table === "entries" && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? ""))) {
        return send(res, 400, { message: "date must be YYYY-MM-DD" });
      }
      const i = rows.findIndex((r) => r.id === row.id);
      if (i >= 0) rows[i] = { ...rows[i], ...row };
      else rows.push({ ...row });
    }
    log.push({ method: "POST", table, count: incoming.length });
    return send(res, 201, undefined);
  }

  return send(res, 405, { message: "method not allowed" });
}).listen(PORT, () => console.log(`fake supabase on http://localhost:${PORT}`));
