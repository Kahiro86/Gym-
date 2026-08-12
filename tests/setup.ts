import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Real IndexedDB in Node for every test — Dexie is never mocked (per the
// storage spec's testing section).
import "fake-indexeddb/auto";
// Harmless outside jsdom-environment component tests; extends `expect`.
import "@testing-library/jest-dom/vitest";

// "virtual:pwa-register/react" only exists when the VitePWA plugin is
// active (vite.config.ts, the real app build) — vitest's own config
// doesn't load that plugin, so PwaUpdateBanner's import of it would fail
// to resolve in every test that renders <App> or <MoreScreen>. Stubbed
// globally to an inert default here; PwaUpdateBanner.test.tsx overrides
// the return value per test to exercise its actual behavior.
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

// A no-op when nothing was rendered (every non-component test), so this is
// safe to run globally rather than per component test file.
afterEach(() => {
  cleanup();
});
