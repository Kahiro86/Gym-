// A short, user-facing description for a caught error (spec §14 task 18).
// Most write failures just get their fallback description back verbatim —
// this only exists to special-case the one scenario LogSetForm's own
// pre-Task-18 comment already called out: storage evicted mid-write reads
// as a completely different problem to a user than a generic failure, so
// it shouldn't be described the same way.
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return "Storage is full — free up space and try again.";
  }
  return fallback;
}
