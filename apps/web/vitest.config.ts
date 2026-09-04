import { reactVitestConfig } from "@tj/config/vitest/react";

// Shared React/jsdom preset (jest-dom matchers, cleanup, css, v8 coverage, `src/**/*.test.{ts,tsx}`).
export default reactVitestConfig({
  test: { env: { VITE_API_URL: "/api", VITE_APP_ENV: "development" } },
});
