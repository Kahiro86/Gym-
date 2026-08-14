// Placeholder entry point — Layer 3 (UI) hasn't started yet. This exists
// only so the dev server has something to serve, and so acceptance tests
// can reach the Layer 1 client via `window.__db`.
import { db } from "./db/index.js";

declare global {
  interface Window { __db: typeof db }
}
window.__db = db;

const root = document.getElementById("root")!;
root.textContent = "Layer 1 (data) in progress — no UI yet.";
