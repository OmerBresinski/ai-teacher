import { reactVitestConfig } from "@tj/config/vitest/react";

// Shared React/jsdom preset (jest-dom, cleanup, css, v8 coverage, `src/**/*.test.{ts,tsx}`).
export default reactVitestConfig({
  test: { setupFiles: ["./vitest.setup.ts"] },
});
