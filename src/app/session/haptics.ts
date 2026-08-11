// Best-effort — silently no-ops where navigator.vibrate doesn't exist
// (most desktop browsers, and always in tests/jsdom). Callers are
// responsible for checking deviceSettings.reduceMotion first (spec:
// haptics respect prefers-reduced-motion) — this function itself has no
// opinion on when it should fire, only how.
export function triggerHaptic(pattern: number | number[] = 200): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}
