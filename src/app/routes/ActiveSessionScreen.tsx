import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSession.js";
import { useSessionExercises } from "../hooks/useSessionExercises.js";
import { useSessionXp } from "../hooks/useSessionXp.js";
import { useWakeLock } from "../hooks/useWakeLock.js";
import { useActiveSessionStore } from "../store/activeSessionStore.js";
import { ExerciseCard } from "../session/ExerciseCard.js";
import { ExerciseSearchSheet } from "../session/ExerciseSearchSheet.js";
import { RestTimer } from "../session/RestTimer.js";
import { SessionXpSummary } from "../session/SessionXpSummary.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { useToast } from "../ui/ToastContext.js";
import styles from "./ActiveSessionScreen.module.css";
import type { SessionExerciseRecord } from "../../storage/types.js";

// The logging screen (spec §14 tasks 6-7 & 10): one ExerciseCard per
// exercise in the session (each with its own last-performance line, set
// list, input form, and swap/skip actions), a way to add more exercises,
// and a way to finish. There is at most one in_progress session at a
// time (sessionRepository enforces it), so this route takes no params.
export function ActiveSessionScreen() {
  const { loading, check, finish } = useSession();
  // Only redirect-on-no-session for a genuinely fresh mount. Finishing
  // the session also clears `check` (same hook instance, same state) —
  // without this guard that reactive change would race the explicit
  // navigate("/today") in handleFinish below and could win, stranding the
  // user on /start instead.
  const hadSessionRef = useRef(false);
  if (check) hadSessionRef.current = true;

  if (loading) return null;
  if (!check && !hadSessionRef.current) return <Navigate to="/start" replace />;
  if (!check) return null;

  const session = check.session;
  return <SessionContent sessionId={session.id} finish={finish} />;
}

interface SessionContentProps {
  sessionId: string;
  finish(id: string, endedAt: number): Promise<void>;
}

// Which mode the one shared search sheet is in — at most one card's swap
// (or a plain add) can be open at a time.
type SheetState = { kind: "add" } | { kind: "swap"; sessionExercise: SessionExerciseRecord } | null;

function SessionContent({ sessionId, finish }: SessionContentProps) {
  const navigate = useNavigate();
  const sessionExercises = useSessionExercises(sessionId);
  const sessionXp = useSessionXp(sessionId);
  const stopRest = useActiveSessionStore((s) => s.stopRest);
  const { showToast } = useToast();
  const [sheet, setSheet] = useState<SheetState>(null);
  // §2: the screen must not sleep for the whole duration of a workout,
  // not just while the rest timer happens to be running.
  useWakeLock(true);
  // The rest timer is a single global store, not scoped per session — a
  // stray countdown must not carry over into whatever's rendered next
  // (finishing this session, or a future one).
  useEffect(() => stopRest, [stopRest]);

  async function handleFinish() {
    try {
      await finish(sessionId, Date.now());
      navigate("/today");
    } catch (err) {
      // Task 18 owns real error-surfacing UI — for now, just don't leave
      // this unhandled.
      console.error("Failed to finish session", err);
    }
  }

  async function handleSkip(se: SessionExerciseRecord) {
    try {
      await sessionExercises.remove(se.id);
      sessionXp.refresh();
      showToast({
        message: "Exercise removed",
        action: {
          label: "Undo",
          // sessionExerciseRepository has no "restore" operation — Undo
          // re-adds an equivalent slot rather than reviving the old row,
          // same simplification as SetList's undo.
          onAction: async () => {
            await sessionExercises.add({
              sessionId,
              exerciseId: se.exerciseId,
              supersetGroup: se.supersetGroup,
              note: se.note,
              plannedFromRoutineExerciseId: se.plannedFromRoutineExerciseId,
            });
            sessionXp.refresh();
          },
        },
      });
    } catch (err) {
      console.error("Failed to skip exercise", err);
    }
  }

  async function handlePick(exerciseId: string) {
    const activeSheet = sheet;
    setSheet(null);
    try {
      if (activeSheet?.kind === "swap") {
        await sessionExercises.substitute(activeSheet.sessionExercise.id, exerciseId);
      } else {
        await sessionExercises.add({ sessionId, exerciseId });
      }
      sessionXp.refresh();
    } catch (err) {
      console.error("Failed to update session exercises", err);
    }
  }

  return (
    <div className={styles.screen}>
      <h1>Session in progress</h1>

      <RestTimer />

      <SessionXpSummary xp={sessionXp.xp} />

      {!sessionExercises.loading && sessionExercises.sessionExercises.length === 0 && (
        <EmptyState title="No exercises yet" description="Add your first exercise below to start logging sets." />
      )}

      {sessionExercises.sessionExercises.map((se) => (
        <ExerciseCard
          key={se.id}
          sessionExerciseId={se.id}
          exerciseId={se.exerciseId}
          sessionId={sessionId}
          onSwap={() => setSheet({ kind: "swap", sessionExercise: se })}
          onSkip={() => handleSkip(se)}
          onSetsChanged={sessionXp.refresh}
        />
      ))}

      <Button variant="secondary" onClick={() => setSheet({ kind: "add" })}>
        Add exercise
      </Button>

      <Button className={styles.finishButton} onClick={handleFinish}>
        Finish workout
      </Button>

      <ExerciseSearchSheet
        open={sheet !== null}
        title={sheet?.kind === "swap" ? "Swap exercise" : "Add exercise"}
        onClose={() => setSheet(null)}
        onPick={handlePick}
      />
    </div>
  );
}
