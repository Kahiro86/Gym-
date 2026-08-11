import { useEffect, useState, type ReactNode } from "react";
import { openDatabaseSafely } from "../../storage/db.js";
import { DatabaseContext, type DatabaseContextValue } from "./context.js";
import { LoadingScreen } from "../ui/LoadingScreen.js";

interface DatabaseProviderProps {
  children: ReactNode;
}

// Module-level singleton: openDatabaseSafely() probes and opens IndexedDB
// (or its degraded in-memory fallback) exactly once per page load, even
// across React 18 StrictMode's double-invoked effects or multiple
// providers mounting during route transitions.
let openPromise: Promise<DatabaseContextValue> | undefined;

function getOrOpen(): Promise<DatabaseContextValue> {
  if (!openPromise) {
    openPromise = openDatabaseSafely().then(({ db, degraded }) => ({ db, degraded }));
  }
  return openPromise;
}

// Shows the branded PlateLoader until the database has opened — on real
// IndexedDB this resolves well within a frame, so it's rarely seen for
// more than a flash. Task 18 owns the degraded-mode banner and any real
// error UI; this is just the loading gap, not that.
export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [value, setValue] = useState<DatabaseContextValue | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOrOpen().then((resolved) => {
      if (!cancelled) setValue(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!value) return <LoadingScreen label="Opening GymXP" />;

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}
