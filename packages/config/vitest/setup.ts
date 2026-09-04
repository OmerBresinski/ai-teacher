/**
 * Shared Vitest setup for React workspaces, registered by `reactVitestConfig()`.
 *
 * - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, …).
 * - Node >= 22.4 exposes an experimental `localStorage` global (a non-functional stub unless
 *   `--localstorage-file` is set). Vitest's jsdom environment only overrides a fixed list of
 *   window keys and `localStorage`/`sessionStorage` are not on it, so the Node stub shadows
 *   jsdom's Storage ("localStorage.clear is not a function"). Point the globals at jsdom's
 *   implementation. `defineProperty` (no read) never triggers Node's warning.
 * - `cleanup()` after every test so rendered trees do not leak between tests.
 *
 * Workspace-specific setup (e.g. the `matchMedia` mock in `packages/ui`) stays in the
 * workspace's own `vitest.setup.ts`, listed after this file in `setupFiles`.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
}

afterEach(() => {
  cleanup();
});
