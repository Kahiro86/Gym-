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
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be called within a <ToastProvider>.");
  }
  return ctx;
}
