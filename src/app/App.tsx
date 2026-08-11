import { Navigate, Route, Routes } from "react-router-dom";
import { TabBar } from "./TabBar";
import { TodayScreen } from "./routes/TodayScreen";
import { HistoryScreen } from "./routes/HistoryScreen";
import { StartScreen } from "./routes/StartScreen";
import { ProgressScreen } from "./routes/ProgressScreen";
import { MoreScreen } from "./routes/MoreScreen";
import styles from "./App.module.css";

// No <BrowserRouter> here — main.tsx supplies it, so tests can wrap this
// component in a <MemoryRouter> instead.
export function App() {
  return (
    <div className={styles.shell}>
      <main className={styles.content}>
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/start" element={<StartScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}
