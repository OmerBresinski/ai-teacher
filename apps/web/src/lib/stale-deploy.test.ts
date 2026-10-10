import { describe, expect, it, mock } from "bun:test";
import { installStaleDeployReload, RELOAD_GUARD_MS } from "./stale-deploy";

function setup(start = 1_000_000) {
  const target = new EventTarget();
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const reload = mock();
  let clock = start;
  const stop = installStaleDeployReload({
    target: target as unknown as Window,
    storage,
    reload,
    now: () => clock,
  });
  const fire = () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const advance = (ms: number) => {
    clock += ms;
  };
  return { fire, reload, stop, advance };
}

describe("stale-deploy reload", () => {
  it("a chunk that fails to load reloads the page once and swallows the error", () => {
    const { fire, reload } = setup();
    expect(fire().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a second failure soon after the reload does not reload again (no loop)", () => {
    const { fire, reload, advance } = setup();
    fire();
    advance(RELOAD_GUARD_MS - 1);
    expect(fire().defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a later deploy reloads again once the guard has passed", () => {
    const { fire, reload, advance } = setup();
    fire();
    advance(RELOAD_GUARD_MS);
    fire();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("without session storage nothing reloads: the import's own catch handles it", () => {
    const target = new EventTarget();
    const reload = mock();
    installStaleDeployReload({ target: target as unknown as Window, storage: null, reload });
    const event = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops listening when uninstalled", () => {
    const { fire, reload, stop } = setup();
    stop();
    fire();
    expect(reload).not.toHaveBeenCalled();
  });
});
