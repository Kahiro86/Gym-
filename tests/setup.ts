import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Real IndexedDB in Node for every test — Dexie is never mocked (per the
// storage spec's testing section).
import "fake-indexeddb/auto";
// Harmless outside jsdom-environment component tests; extends `expect`.
import "@testing-library/jest-dom/vitest";

// A no-op when nothing was rendered (every non-component test), so this is
// safe to run globally rather than per component test file.
afterEach(() => {
  cleanup();
});
