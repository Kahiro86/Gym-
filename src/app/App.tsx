import { Navigate, Route, Routes } from "react-router-dom";
import { TabBar } from "./TabBar";
import { TodayScreen } from "./routes/TodayScreen";
import { HistoryScreen } from "./routes/HistoryScreen";
import { StartScreen } from "./routes/StartScreen";
import { ProgressScreen } from "./routes/ProgressScreen";
import { MoreScreen } from "./routes/MoreScreen";
import { RoutineDetailScreen } from "./routes/RoutineDetailScreen";
import { ActiveSessionScreen } from "./routes/ActiveSessionScreen";
import { SessionSummaryScreen } from "./routes/SessionSummaryScreen";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { PwaUpdateBanner } from "./pwa/PwaUpdateBanner.js";
import { useOnboarding } from "./hooks/useOnboarding.js";
import { LoadingScreen } from "./ui/LoadingScreen.js";
import styles from "./App.module.css";

// No <BrowserRouter> here — main.tsx supplies it, so tests can wrap this
// component in a <MemoryRouter> instead.
export function App() {
  const { loading, completed, complete } = useOnboarding();

  // Onboarding's own check resolves near-instantly against local storage,
  // so this is rarely seen for more than a flash. Task 18 owns any real
  // degraded/error UI; this is just the loading gap, not that.
  if (loading) return <LoadingScreen />;

  if (!completed) {
    return <OnboardingFlow onDone={complete} />;
  }

  return (
    <div className={styles.shell}>
      <PwaUpdateBanner />
      <main className={styles.content}>
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/start" element={<StartScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="/routines/:id" element={<RoutineDetailScreen />} />
          <Route path="/session" element={<ActiveSessionScreen />} />
          <Route path="/session/summary" element={<SessionSummaryScreen />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}
