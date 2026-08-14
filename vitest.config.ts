import { defineConfig } from "vitest/config";

// Unit tests cover Layer 2's pure core only — it needs no browser, no
// database, and no DOM, which is the point of keeping the arithmetic
// separate from the fetching. The Worker/OPFS-dependent layers are
// covered by the Playwright suites under tests/acceptance instead.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
