import { useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSession.js";
import { useSessionExercises } from "../hooks/useSessionExercises.js";
import { useWakeLock } from "../hooks/useWakeLock.js";
import { useActiveSessionStore } from "../store/activeSessionStore.js";
import { ExerciseCard } from "../session/ExerciseCard.js";
import { AddExerciseField } from "../session/AddExerciseField.js";
import { RestTimer } from "../session/RestTimer.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import styles from "./ActiveSessionScreen.module.css";

// The logging screen (spec §14 tasks 6-7): one ExerciseCard per exercise
// in the session (each with its own last-performance line, set list, and
// input form), an add-exercise field, and a way to finish. There is at
// most one in_progress session at a time (sessionRepository enforces it),
// so this route takes no params.
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

function SessionContent({ sessionId, finish }: SessionContentProps) {
  const navigate = useNavigate();
  const sessionExercises = useSessionExercises(sessionId);
  const stopRest = useActiveSessionStore((s) => s.stopRest);
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

  async function handleAdd(exerciseId: string) {
    try {
      await sessionExercises.add({ sessionId, exerciseId });
    } catch (err) {
      console.error("Failed to add exercise to session", err);
    }
  }

  return (
    <div className={styles.screen}>
      <h1>Session in progress</h1>

      <RestTimer />

      {!sessionExercises.loading && sessionExercises.sessionExercises.length === 0 && (
        <EmptyState title="No exercises yet" description="Add your first exercise below to start logging sets." />
      )}

      {sessionExercises.sessionExercises.map((se) => (
        <ExerciseCard key={se.id} sessionExerciseId={se.id} exerciseId={se.exerciseId} sessionId={sessionId} />
      ))}

      <AddExerciseField onAdd={handleAdd} />

      <Button className={styles.finishButton} onClick={handleFinish}>
        Finish workout
      </Button>
    </div>
  );
}
