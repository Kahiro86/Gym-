// Placeholder entry point — Layer 3 (UI) has not started. This exists so
// the dev server has something to serve and so the browser-driven
// acceptance suites can reach Layer 1 and Layer 2.
import { db } from "./db/index.js";
import * as logic from "./logic/index.js";

declare global {
  interface Window {
    __db: typeof db;
    __logic: typeof logic;
  }
}

window.__db = db;
window.__logic = logic;

document.getElementById("root")!.textContent = "Layers 1-2 complete. UI not started.";
