import { ListRow } from "../ui/ListRow.js";
import { formatRelativeDay } from "../formatRelativeDay.js";
import type { HistoryEntry } from "../hooks/useSessionHistory.js";
import type { SessionState } from "../../storage/types.js";

const STATE_LABEL: Partial<Record<SessionState, string>> = {
  in_progress: "In progress",
  abandoned: "Abandoned",
};

export interface HistoryRowProps {
  entry: HistoryEntry;
}

// One past session in the History tab's list (spec §14 task 14) — date,
// what it earned (if it earned anything), and a state label for the
// non-"completed" cases (discarded sessions never reach here at all;
// listRecent() already excludes them, per §6.2).
export function HistoryRow({ entry }: HistoryRowProps) {
  const { session, xp } = entry;
  const stateLabel = STATE_LABEL[session.state];
  const trailing = xp
    ? `${Math.round(xp.total)} XP${xp.prs.length > 0 ? ` · ${xp.prs.length} PR${xp.prs.length === 1 ? "" : "s"}` : ""}`
    : undefined;

  return <ListRow label={formatRelativeDay(session.startedAt)} description={stateLabel} trailing={trailing} />;
}
