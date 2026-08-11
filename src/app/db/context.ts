import { createContext, useContext } from "react";
import type { GymDatabase } from "../../storage/db.js";

// The one place Layer 3 is allowed to know a Dexie-backed GymDatabase
// exists at all — every hook reaches storage through a Layer 2 repository
// built from this, never through `db` directly.
export interface DatabaseContextValue {
  db: GymDatabase;
  // True when IndexedDB was unavailable and `db` is running on the
  // in-memory fallback (§3.1) — nothing written survives a reload. Task 18
  // owns the actual banner UI; this is just where the flag lives.
  degraded: boolean;
}

export const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function useDatabase(): DatabaseContextValue {
  const ctx = useContext(DatabaseContext);
  if (!ctx) {
    throw new Error("useDatabase() must be called within a <DatabaseProvider>.");
  }
  return ctx;
}
