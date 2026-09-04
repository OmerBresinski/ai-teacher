/**
 * `bun test` preload #2 for React workspaces — runs after `./dom.ts` has registered happy-dom.
 *
 * - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveTextContent`, …) on Bun's
 *   `expect`. The `/vitest` and `/jest-globals` entry points do not exist for Bun; extend by hand.
 * - `cleanup()` after every test so rendered trees never leak between tests.
 *
 * Workspace-specific setup (e.g. the `matchMedia` mock in `packages/ui`) lives in the workspace's
 * own `bun-test.setup.ts`, listed after this file in `bunfig.toml#[test].preload`.
 */
import { afterEach, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
