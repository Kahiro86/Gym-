import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSession.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { useToast } from "../ui/ToastContext.js";
import { StartSheet } from "../start/StartSheet.js";
import styles from "./StartScreen.module.css";

export function StartScreen() {
  const navigate = useNavigate();
  const session = useSession();
  const { reportError } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (session.loading) return null;

  const active = session.check;

  function handleContinue() {
    navigate("/session");
  }

  async function handleResume() {
    if (!active) return;
    try {
      await session.resume(active.session.id);
      navigate("/session");
    } catch (err) {
      reportError(err, "Failed to resume session");
    }
  }

  async function handleDiscard() {
    if (!active) return;
    try {
      await session.discard(active.session.id);
    } catch (err) {
      reportError(err, "Failed to discard session");
    }
  }

  return (
    <div className={styles.screen}>
      <h1>Start</h1>

      {active && !active.isStale && (
        <Card className={styles.resumeCard}>
          <p className={styles.resumeLabel}>Session in progress</p>
          <Button onClick={handleContinue}>Continue workout</Button>
        </Card>
      )}

      {active && active.isStale && (
        <Card className={styles.resumeCard}>
          <p className={styles.resumeLabel}>You left a session running</p>
          <div className={styles.resumeActions}>
            <Button onClick={handleResume}>Resume</Button>
            <Button variant="secondary" onClick={handleDiscard}>
              Discard
            </Button>
          </div>
        </Card>
      )}

      {!active && (
        <Button className={styles.startButton} onClick={() => setSheetOpen(true)}>
          Start Workout
        </Button>
      )}

      <StartSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onStarted={() => {
          setSheetOpen(false);
          navigate("/session");
        }}
      />
    </div>
  );
}
