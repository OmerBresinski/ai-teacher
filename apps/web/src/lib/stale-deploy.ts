/**
 * Stale-deploy recovery. After a deploy, a tab opened on the old build asks for lazy chunks whose
 * hashed files are gone, and Vite fires `vite:preloadError` on the window. The page reloads once
 * to pick up the new build. A second failure within `RELOAD_GUARD_MS` of that reload is not a
 * stale deploy (the chunk is missing from the new build too, or the network is down): no reload,
 * so the page never loops, and the error reaches the import's own catch.
 */
export const RELOAD_GUARD_MS = 60_000;
const KEY = "tj:stale-deploy-reload-at";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function installStaleDeployReload({
  target = window,
  storage = safeSessionStorage(),
  reload = () => window.location.reload(),
  now = Date.now,
}: {
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
  storage?: Storage | null;
  reload?: () => void;
  now?: () => number;
} = {}): () => void {
  const onPreloadError = (event: Event) => {
    // Without storage there is no loop guard: let the import's own catch handle it.
    if (!storage) return;
    let last = Number.NaN;
    try {
      last = Number(storage.getItem(KEY));
    } catch {
      return;
    }
    if (Number.isFinite(last) && now() - last < RELOAD_GUARD_MS) return;
    try {
      storage.setItem(KEY, String(now()));
    } catch {
      return;
    }
    // Reloading: the failed import must not surface as an error on its way out.
    event.preventDefault();
    reload();
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => target.removeEventListener("vite:preloadError", onPreloadError);
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
