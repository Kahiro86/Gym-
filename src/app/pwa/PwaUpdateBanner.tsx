import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useToast } from "../ui/ToastContext.js";

const UPDATE_TOAST_DURATION_MS = 15000;

// Surfaces the service worker's lifecycle through the app's existing toast
// system (spec §14 task 17) instead of reloading silently — a version swap
// under the user mid-session is exactly the kind of surprise §2's "no
// optimistic UI" ethos avoids elsewhere, so this always waits for an
// explicit tap. Renders nothing itself; it only exists to run the hook and
// react to its state.
export function PwaUpdateBanner() {
  const { showToast } = useToast();
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Service worker registration failed", error);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      showToast({ message: "Ready to work offline" });
    }
  }, [offlineReady, showToast]);

  useEffect(() => {
    if (needRefresh) {
      showToast({
        message: "A new version is available",
        durationMs: UPDATE_TOAST_DURATION_MS,
        action: { label: "Reload", onAction: () => updateServiceWorker(true) },
      });
    }
  }, [needRefresh, showToast, updateServiceWorker]);

  return null;
}
