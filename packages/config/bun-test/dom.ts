/**
 * `bun test` preload #1 for React workspaces (`apps/web`, `packages/ui`) — ADR 0014 (amended).
 *
 * Registers happy-dom's `window`, `document`, `localStorage`, `HTMLElement`, … on `globalThis`
 * so React Testing Library can render. This must be a separate preload from `./setup.ts`: ESM
 * hoists imports, so anything that touches the DOM at import time (`@testing-library/react`)
 * would otherwise run before the registrator. Bun executes preloads in order, one module at a
 * time, so listing `dom` first in `bunfig.toml#[test].preload` guarantees the DOM exists.
 *
 * ```toml
 * [test]
 * preload = ["@tj/config/bun-test/dom", "@tj/config/bun-test/setup"]
 * ```
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000/" });
}
