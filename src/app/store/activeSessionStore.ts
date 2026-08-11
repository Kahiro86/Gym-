import { create } from "zustand";

export interface ActiveSessionState {
  // The rest timer's only real state is *when it started* and *how long
  // it's for* — remaining time is always derived from wall-clock time at
  // render time (useRestRemaining), never decremented tick by tick. That's
  // the whole point: a backgrounded/throttled tab can never desync a
  // countdown that's recomputed fresh from Date.now() every time it's read.
  restStartedAt: number | null;
  restDurationSec: number;
  startRest(durationSec: number): void;
  stopRest(): void;
  addRestSeconds(deltaSec: number): void;
}

// The single Zustand store for in-session UI state (spec: draft input
// only, no optimistic UI) — never a cache of persisted data, which always
// flows through the Layer 2 repository hooks instead.
export const useActiveSessionStore = create<ActiveSessionState>((set) => ({
  restStartedAt: null,
  restDurationSec: 0,

  startRest: (durationSec) => set({ restStartedAt: Date.now(), restDurationSec: durationSec }),

  stopRest: () => set({ restStartedAt: null, restDurationSec: 0 }),

  addRestSeconds: (deltaSec) => set((state) => ({ restDurationSec: Math.max(0, state.restDurationSec + deltaSec) })),
}));
