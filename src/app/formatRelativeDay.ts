const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// A short, human "how long ago" label — used by the Today tab's
// last-workout card and the History tab's session list. Deliberately just
// device-local calendar days (Date, not time.ts's own day-boundary math),
// since this is a passing display label, not anything that changes what a
// set counts toward.
export function formatRelativeDay(epochMs: number, now: number = Date.now()): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(epochMs)) / DAY_MS);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
