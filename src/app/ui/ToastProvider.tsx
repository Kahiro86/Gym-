import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ToastContext, type ToastOptions } from "./ToastContext.js";
import styles from "./Toast.module.css";

interface ActiveToast extends ToastOptions {
  id: number;
}

const DEFAULT_DURATION_MS = 5000;

// The spec's undo-toast pattern (§2): destructive actions get a
// dismissible, auto-expiring toast with an optional Undo action instead of
// a blocking confirm dialog. One toast at a time — a new call replaces
// whatever is currently showing.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast(null);
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const id = ++nextId.current;
    setToast({ id, ...options });
    timeoutRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, options.durationMs ?? DEFAULT_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          <span className={styles.message}>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                toast.action!.onAction();
                dismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
