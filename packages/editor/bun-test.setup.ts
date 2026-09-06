/**
 * Workspace-specific `bun test` preload for `@tj/editor`. jest-dom matchers, happy-dom and
 * `cleanup()` come from the shared preloads (`@tj/config/bun-test/{dom,setup}`); this file adds
 * the browser APIs the slide renderer touches and happy-dom lacks: `ResizeObserver` (SlideScaler,
 * auto-height), `PointerEvent` (the transform layer, phase C) and `requestAnimationFrame`.
 */
import { afterEach, beforeEach } from "bun:test";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class PointerEventMock extends MouseEvent {}

const installed: (() => void)[] = [];

beforeEach(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    installed.push(() => {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    });
  }
  if (!globalThis.PointerEvent) {
    globalThis.PointerEvent = PointerEventMock as unknown as typeof PointerEvent;
    installed.push(() => {
      delete (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
    });
  }
});

afterEach(() => {
  for (const undo of installed.splice(0)) undo();
});
