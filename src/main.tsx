import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { db } from "./db/index.js";
import * as logic from "./logic/index.js";
import { ListScreen } from "./ui/ListScreen.js";
import { DetailScreen } from "./ui/DetailScreen.js";
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
  // Two screens so far, so navigation is a single piece of state rather
  // than a router. Screen 3 (calendar) joins at the next gate.
  const [openHabitId, setOpenHabitId] = useState<string | null>(null);

  return openHabitId
    ? <DetailScreen habitId={openHabitId} onBack={() => setOpenHabitId(null)} />
    : <ListScreen onOpenHabit={(habit) => setOpenHabitId(habit.id)} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
