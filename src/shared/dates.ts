// Monday-start ISO week bucketing, shared by heatmap/store.ts and
// storage/ — both need the same week semantics, so it lives in one place
// rather than each defining its own.

export const MS_PER_DAY = 86_400_000;

export function weekStartFor(timestampMs: number): string {
  const date = new Date(timestampMs);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = utc.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday);
  return isoDate(utc);
}

export function addWeeks(weekStart: string, weeks: number): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return isoDate(date);
}

export function dayStartFor(timestampMs: number): string {
  const date = new Date(timestampMs);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
