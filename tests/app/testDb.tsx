import type { ReactNode } from "react";
import { DatabaseContext } from "../../src/app/db/context.js";
import type { GymDatabase } from "../../src/storage/db.js";

export function uniqueDbName(): string {
  return `test-db-${Math.random().toString(36).slice(2)}`;
}

// Bypasses <DatabaseProvider>'s async openDatabaseSafely() dance so hook
// tests can supply an already-open, uniquely-named GymDatabase directly.
export function withDatabase(db: GymDatabase) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DatabaseContext.Provider value={{ db, degraded: false }}>{children}</DatabaseContext.Provider>;
  };
}
