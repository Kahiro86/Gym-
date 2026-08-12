import { createContext, useContext } from "react";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: string;
  action?: ToastAction;
  durationMs?: number;
}

export interface ToastContextValue {
  showToast(options: ToastOptions): void;
  // Logs the error for diagnostics and surfaces a user-visible toast
  // (spec §14 task 18) — the one place every "Task 18 owns real
  // error-surfacing UI" catch block across the app funnels into, instead
  // of a silent console.error with nothing shown to the user.
  reportError(err: unknown, fallbackMessage: string): void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be called within a <ToastProvider>.");
  }
  return ctx;
}
