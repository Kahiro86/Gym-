import { useEffect, useState } from "react";
import { useActiveSessionStore } from "../store/activeSessionStore.js";

// Ticks a re-render every 250ms while resting, but the returned value is
// always (re)computed from Date.now() minus restStartedAt — never a
// counter decremented by the interval itself. A throttled/backgrounded
// tab that misses ticks just jumps straight to the correct remaining
// time on its next tick, rather than drifting.
export function useRestRemaining(): number | null {
  const restStartedAt = useActiveSessionStore((s) => s.restStartedAt);
  const restDurationSec = useActiveSessionStore((s) => s.restDurationSec);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (restStartedAt === null) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(interval);
  }, [restStartedAt]);

  if (restStartedAt === null) return null;
  const elapsedSec = (Date.now() - restStartedAt) / 1000;
  return Math.max(0, Math.ceil(restDurationSec - elapsedSec));
}
