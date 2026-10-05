import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each suite boots its own in-process Postgres; under parallel test files
    // on a slow CI runner that can take longer than the 10s default.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
