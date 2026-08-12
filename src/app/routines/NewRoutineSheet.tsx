import { useEffect, useState } from "react";
import { Sheet } from "../ui/Sheet.js";
import { Button } from "../ui/Button.js";
import { useToast } from "../ui/ToastContext.js";
import styles from "./NewRoutineSheet.module.css";

export interface NewRoutineSheetProps {
  open: boolean;
  onClose(): void;
  onCreate(name: string): Promise<void>;
}

// Minimal creation flow (spec §14 task 16): a routine needs only a name to
// exist — its exercises are added afterward on the routine's own detail
// screen, the same "create empty, then fill in" shape sessions themselves
// use (a session starts with no exercises either).
export function NewRoutineSheet({ open, onClose, onCreate }: NewRoutineSheetProps) {
  const [name, setName] = useState("");
  const { reportError } = useToast();

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await onCreate(trimmed);
    } catch (err) {
      reportError(err, "Failed to create routine");
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New routine">
      <input
        className={styles.input}
        type="text"
        placeholder="Routine name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Routine name"
        autoFocus
      />
      <Button className={styles.createButton} disabled={name.trim() === ""} onClick={handleCreate}>
        Create
      </Button>
    </Sheet>
  );
}
