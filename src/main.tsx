import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { db } from "./db/index.js";
import * as logic from "./logic/index.js";
import { ListScreen } from "./ui/ListScreen.js";
import "./ui/tokens.css";

declare global {
  interface Window {
    __db: typeof db;
    __logic: typeof logic;
  }
}

// Exposed for the browser-driven acceptance suites, which exercise
// Layers 1 and 2 directly against the real Worker + OPFS stack.
window.__db = db;
window.__logic = logic;

function App() {
  // Screen 2 (Detail) is the next build gate; tapping a habit name has
  // nowhere to navigate yet, so this stays deliberately inert rather
  // than opening a stand-in screen.
  return <ListScreen onOpenHabit={() => {}} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
