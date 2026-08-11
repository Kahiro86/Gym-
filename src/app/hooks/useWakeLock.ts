import { useEffect } from "react";

// §2: the screen must not sleep mid-workout. Best-effort only — silently
// no-ops where the API doesn't exist (most desktop browsers, and always
// in tests/jsdom) or a request is rejected (e.g. some platforms deny it
// on low battery); there is nothing to recover from a denied request
// beyond leaving the screen free to sleep, same as before this hook ran.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.wakeLock) return;

    let sentinel: WakeLockSentinel | undefined;
    let cancelled = false;

    navigator.wakeLock
      .request("screen")
      .then((lock) => {
        if (cancelled) {
          lock.release().catch(() => {});
        } else {
          sentinel = lock;
        }
      })
      .catch(() => {
        // Nothing to recover from — see comment above.
      });

    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}
