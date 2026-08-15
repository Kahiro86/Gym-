import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { db } from "./db/index.js";
import * as logic from "./logic/index.js";
import type { Habit } from "./db/types.js";
import { ListScreen } from "./ui/ListScreen.js";
import { DetailScreen } from "./ui/DetailScreen.js";
import { CalendarScreen } from "./ui/CalendarScreen.js";
import { HabitEditor } from "./ui/HabitEditor.js";
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

type Route =
  | { screen: "list" }
  | { screen: "detail"; habitId: string }
  | { screen: "calendar"; habitId: string }
  | { screen: "create" }
  | { screen: "edit"; habit: Habit };

function App() {
  // One linear path in and back out — a router would be more machinery
  // than the navigation actually has.
  const [route, setRoute] = useState<Route>({ screen: "list" });
  // Bumped whenever the editor writes, so the list re-reads. Without it,
  // a habit created here would not appear until a manual reload.
  const [revision, setRevision] = useState(0);
  const backToList = () => setRoute({ screen: "list" });
  const afterWrite = () => { setRevision((n) => n + 1); backToList(); };

  switch (route.screen) {
    case "create":
      return <HabitEditor onDone={afterWrite} onCancel={backToList} />;
    case "edit":
      return <HabitEditor habit={route.habit} onDone={afterWrite} onCancel={backToList} />;
    case "detail":
      return (
        <DetailScreen
          habitId={route.habitId}
          onBack={() => setRoute({ screen: "list" })}
          onOpenCalendar={() => setRoute({ screen: "calendar", habitId: route.habitId })}
          onEdit={(habit) => setRoute({ screen: "edit", habit })}
        />
      );
    case "calendar":
      return (
        <CalendarScreen
          habitId={route.habitId}
          onBack={() => setRoute({ screen: "detail", habitId: route.habitId })}
        />
      );
    default:
      return (
        <ListScreen
          key={revision}
          onOpenHabit={(habit) => setRoute({ screen: "detail", habitId: habit.id })}
          onAddHabit={() => setRoute({ screen: "create" })}
        />
      );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
