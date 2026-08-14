// Placeholder entry point — Layer 3 (UI) hasn't started yet. This exists
// only so the dev server has something to serve, and so acceptance/
// verification tests can reach Layer 1's client and Layer 2's logic
// functions via window.__db / window.__logic.
import { db } from "./db/index.js";
import * as logic from "./logic/index.js";

declare global {
  interface Window { __db: typeof db; __logic: typeof logic }
}
window.__db = db;
window.__logic = logic;

const root = document.getElementById("root")!;
root.textContent = "Layer 2 (logic) in progress — no UI yet.";
