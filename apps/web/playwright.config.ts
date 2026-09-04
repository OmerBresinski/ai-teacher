/**
 * Playwright end-to-end tests for `@tj/web` (ADR 0014, TEACH-22). See docs/testing.md.
 *
 * `webServer` boots the whole stack against the **test** database, on ports that never collide
 * with `bun run dev` (5173/3001/3002):
 *
 *   api     http://localhost:3811   NODE_ENV=test ENABLE_TEST_ROUTES=1 → GET /__test/last-magic-link
 *   worker  http://localhost:3822   runs the `ping` jobs the specs enqueue
 *   web     http://localhost:4193   `vite build` (VITE_API_URL baked to the api above) + `vite preview`
 *
 * The api command migrates TEST_DATABASE_URL first (`packages/db/src/migrate.ts`), so a fresh
 * database works. Locally `reuseExistingServer` lets you keep the three processes running between
 * runs; in CI every run starts them.
 */
import { defineConfig, devices } from "@playwright/test";

export const E2E_PORTS = { api: 3811, worker: 3822, web: 4193 } as const;
export const E2E_API_URL = `http://localhost:${E2E_PORTS.api}`;
export const E2E_WEB_URL = `http://localhost:${E2E_PORTS.web}`;

const CI = process.env.CI === "true";
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/teaching_journey_test";
// Deliberately not a secret: the e2e api only ever talks to the throwaway test database.
const E2E_AUTH_SECRET = "e2e-only-secret-not-used-anywhere-else-0123456789";
const stdout = process.env.E2E_VERBOSE ? "pipe" : "ignore";

export default defineConfig({
  testDir: "./e2e",
  // Naming rule (docs/testing.md): Playwright owns `e2e/**/*.spec.ts`; `bun test` owns `src/**/*.test.*`.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: CI,
  // One retry in CI only: SSE timing is asserted with `expect.poll`, so a retry here points at a
  // real flake worth a look (the html report keeps the trace of the failed attempt).
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      cwd: "../api",
      command: "bun ../../packages/db/src/migrate.ts && bun src/index.ts",
      url: `${E2E_API_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout,
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        ENABLE_TEST_ROUTES: "1",
        PORT: String(E2E_PORTS.api),
        DATABASE_URL: TEST_DATABASE_URL,
        TEST_DATABASE_URL,
        WEB_ORIGIN: E2E_WEB_URL,
        BETTER_AUTH_URL: E2E_API_URL,
        BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
        MAIL_PROVIDER: "console",
        LOG_LEVEL: process.env.E2E_VERBOSE ? "info" : "warn",
      },
    },
    {
      name: "worker",
      cwd: "../worker",
      command: "bun src/index.ts",
      url: `http://localhost:${E2E_PORTS.worker}/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout,
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        PORT: String(E2E_PORTS.worker),
        DATABASE_URL: TEST_DATABASE_URL,
        WORKER_CONCURRENCY: "2",
        LOG_LEVEL: process.env.E2E_VERBOSE ? "info" : "warn",
      },
    },
    {
      name: "web",
      cwd: ".",
      // A production build must bake an absolute VITE_API_URL (src/env.ts), so the e2e build is
      // separate from `dist/` (which `bun run build` produces with the `.env` value `/api`).
      command: `bun --bun vite build --outDir dist/e2e && bun --bun vite preview --outDir dist/e2e --port ${E2E_PORTS.web} --strictPort`,
      url: E2E_WEB_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      stdout,
      stderr: "pipe",
      env: { VITE_API_URL: E2E_API_URL, VITE_APP_ENV: "preview" },
    },
  ],
});
