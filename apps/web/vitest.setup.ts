import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Node >= 22.4 exposes an experimental `localStorage` stub that shadows jsdom's Storage under
 * Vitest (see packages/ui/vitest.setup.ts). Point the globals at jsdom's implementation.
 */
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
