import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { db } from "./db/index.js";
import * as logic from "./logic/index.js";
import { ListScreen } from "./ui/ListScreen.js";
import { DetailScreen } from "./ui/DetailScreen.js";
import { CalendarScreen } from "./ui/CalendarScreen.js";
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
  | { screen: "calendar"; habitId: string };

function App() {
  // Three screens, one linear path in and back out — a router would be
  // more machinery than the navigation actually has.
  const [route, setRoute] = useState<Route>({ screen: "list" });

  switch (route.screen) {
    case "detail":
      return (
        <DetailScreen
          habitId={route.habitId}
          onBack={() => setRoute({ screen: "list" })}
          onOpenCalendar={() => setRoute({ screen: "calendar", habitId: route.habitId })}
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
      return <ListScreen onOpenHabit={(habit) => setRoute({ screen: "detail", habitId: habit.id })} />;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
