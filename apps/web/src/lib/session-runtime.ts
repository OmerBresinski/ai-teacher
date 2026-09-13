import { createRouter } from "@tanstack/react-router";
import { toast } from "@tj/ui";
import { router } from "@/router";
import { meQueryOptions } from "./query";
import { connectSessionTabs, sessionBoundary } from "./session-boundary";

// `router.tsx` supplies the typed tree/options. Runtime matches are owned by one session only.
export let sessionRouter = createRouter({ ...router.options });

/** Installed once by main.tsx, outside React StrictMode's mount/effect cycle. */
export function startSessionRuntime(): () => void {
  const disconnect = connectSessionTabs(sessionBoundary);
  let epoch = sessionBoundary.getSnapshot().epoch;
  const unsubscribe = sessionBoundary.subscribe(() => {
    const state = sessionBoundary.getSnapshot();
    if (epoch === state.epoch) return;
    epoch = state.epoch;
    for (const match of sessionRouter.state.matches) {
      match.abortController.abort();
    }
    sessionRouter.clearCache();
    sessionRouter = createRouter({ ...router.options, context: { queryClient: state.client } });
    toast.dismiss(); // Remove old Undo/View callbacks and any content-bearing proposal copy.
    document.title = "Teaching Journey";
    try {
      localStorage.removeItem("tj:brief:last-class");
    } catch {
      /* storage may be unavailable */
    }
    // The root is keyed by epoch. Fresh router matches contain no old loader results; old
    // history refs, streams and autosave hooks unmount before the next identity can render.
    queueMicrotask(() => {
      if (sessionBoundary.getSnapshot().epoch !== state.epoch) return;
      void sessionRouter
        .navigate({
          to: state.identity === null ? "/sign-in" : "/lessons",
          search: {},
          replace: true,
          ignoreBlocker: true,
        })
        .catch(() => {
          // Fresh routes still require /me; navigation errors cannot reveal the retired cache.
        });
    });
  });
  const check = () => {
    const { client, identity, locked } = sessionBoundary.getSnapshot();
    if (locked || identity == null) return;
    void client.fetchQuery({ ...meQueryOptions, staleTime: 0 }).catch(() => {
      if (sessionBoundary.getSnapshot().client === client) sessionBoundary.reset(null, true);
    });
  };
  const timer = setInterval(check, 30_000);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  // A page restored from BFCache must revalidate before any private subtree is restored.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) sessionBoundary.reset();
  };
  window.addEventListener("pageshow", onPageShow);
  return () => {
    disconnect();
    unsubscribe();
    clearInterval(timer);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
    window.removeEventListener("pageshow", onPageShow);
  };
}
