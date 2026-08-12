import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Retro-arcade fonts (tokens.css's --font-display/--font-body/--font-mono)
// — self-hosted like the "calibrated iron" theme's fonts were, so this is
// still offline-first. Both ship a single 400 weight only (pixel/terminal
// faces don't come in a range of weights).
import "@fontsource/press-start-2p/400.css";
import "@fontsource/vt323/400.css";
import "./tokens.css";
import "./global.css";
import { App } from "./App";
import { DatabaseProvider } from "./db/DatabaseProvider";
import { ToastProvider } from "./ui/ToastProvider";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found.");
}

// import.meta.env.BASE_URL mirrors vite.config.ts's `base` ("/" in dev,
// "/Gym-/" in production — see that file's comment) — read back here
// instead of hardcoding the subpath a second time. BrowserRouter wants no
// trailing slash on basename ("/Gym-", not "/Gym-/"); "/" strips down to
// "" (no basename), matching its own no-subpath default.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(container).render(
  <StrictMode>
    <DatabaseProvider>
      <BrowserRouter basename={basename}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </DatabaseProvider>
  </StrictMode>
);
