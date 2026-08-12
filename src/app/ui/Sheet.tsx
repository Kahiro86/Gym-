import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import styles from "./Sheet.module.css";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Bottom-anchored per spec §2 (reachability: controls live in the bottom
// 55% of the screen) — this is never a centered dialog.
//
// Focus management (spec §14 task 19): a modal dialog has to move focus
// in on open (or a screen-reader user has no signal it opened at all),
// trap Tab/Shift+Tab so focus can't silently land on whatever's behind
// the backdrop, and restore focus to whatever opened it on close. Content
// that already claims its own initial focus (ExerciseSearchSheet's and
// NewRoutineSheet's search/name inputs both use autoFocus) keeps working
// unchanged — the fallback below only fires when nothing else already
// has focus inside the sheet a tick after mount.
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFallbackId = window.setTimeout(() => {
      const sheet = sheetRef.current;
      if (sheet && !sheet.contains(document.activeElement)) {
        sheet.focus();
      }
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusFallbackId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {title && <h2 className={styles.title}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
