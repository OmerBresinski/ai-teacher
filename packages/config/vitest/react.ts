/**
 * Shared Vitest preset for React workspaces (`apps/web`, `packages/ui`) — ADR 0014.
 *
 * jsdom environment, Testing Library + `jest-dom` matchers (via `./setup.ts`), `css: true`, v8
 * coverage and the naming rule that keeps Vitest and `bun test` apart (docs/testing.md):
 * Vitest only ever looks at `src/**\/*.test.{ts,tsx}`; Playwright specs are `e2e/**\/*.spec.ts`.
 *
 * Usage (`vitest.config.ts`):
 *
 * ```ts
 * import { reactVitestConfig } from "@tj/config/vitest/react";
 * export default reactVitestConfig({ test: { setupFiles: ["./vitest.setup.ts"] } });
 * ```
 *
 * `overrides` is deep-merged on top of the preset (`mergeConfig`): arrays such as `setupFiles`
 * and `plugins` are concatenated, scalars are replaced.
 */
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

export const SHARED_SETUP_FILE = fileURLToPath(new URL("./setup.ts", import.meta.url));

/** Files Vitest runs. Anything else (`*.spec.ts`, `bun test` files) is invisible to it. */
export const VITEST_INCLUDE = ["src/**/*.test.{ts,tsx}"];

export function reactVitestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  const base = defineConfig({
    plugins: [react()],
    resolve: {
      // Honour `paths` from the consumer's tsconfig.json (`@/*` → `./src/*`) without a plugin.
      tsconfigPaths: true,
    },
    test: {
      environment: "jsdom",
      globals: true,
      css: true,
      include: VITEST_INCLUDE,
      setupFiles: [SHARED_SETUP_FILE],
      coverage: {
        provider: "v8",
        // Written on demand (`vitest run --coverage`); CI turns it on so turbo can cache the output.
        enabled: process.env.CI === "true",
        reportsDirectory: "./coverage",
        reporter: ["text-summary", "lcov"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.test-d.{ts,tsx}", "src/test/**"],
      },
    },
  });
  return mergeConfig(base, overrides);
}
