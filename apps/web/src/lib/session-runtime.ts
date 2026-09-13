import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "@tj/ui";
import { router } from "@/router";
import { seriesDetailRoute } from "@/routes/library.route";
import { rememberShell } from "./last-shell";
import { meQueryOptions } from "./query";
import { connectSessionTabs, sessionBoundary } from "./session-boundary";

// `router.tsx` supplies the typed tree/options. Runtime matches are owned by one session only.
function createSessionRouter(client: QueryClient) {
  const next = createRouter({ ...router.options, context: { queryClient: client } });
  next.subscribe("onResolved", ({ toLocation }) => {
    const missingSeries = next.state.matches.some(
      (match) => match.routeId === seriesDetailRoute.id && match.loaderData === null,
    );
    if (!missingSeries) rememberShell(toLocation.pathname);
  });
  return next;
}
export let sessionRouter = createSessionRouter(sessionBoundary.getSnapshot().client);

/** Installed once by main.tsx, outside React StrictMode's mount/effect cycle. */
export function startSessionRuntime(): () => void {
  const disconnect = connectSessionTabs(sessionBoundary);
  let epoch = sessionBoundary.getSnapshot().epoch;
  let identity = sessionBoundary.getSnapshot().identity;
  const unsubscribe = sessionBoundary.subscribe(() => {
    const state = sessionBoundary.getSnapshot();
    const previousIdentity = identity;
    identity = state.identity;
    if (epoch === state.epoch) return;
    epoch = state.epoch;
    for (const match of sessionRouter.state.matches) {
      match.abortController.abort();
    }
    sessionRouter.clearCache();
    const previousHref = sessionRouter.latestLocation.href;
    sessionRouter = createSessionRouter(state.client);
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
      if (state.identity === undefined) {
        void state.client
          .fetchQuery({ ...meQueryOptions, staleTime: 0 })
          .then((me) => {
            if (sessionBoundary.getSnapshot().epoch !== state.epoch) return;
            const confirmed = me ? `${me.user.id}:${me.workspaceId}` : null;
            const href =
              confirmed === previousIdentity && !previousHref.startsWith("/sign-in")
                ? previousHref
                : me
                  ? "/lessons"
                  : "/sign-in";
            return sessionRouter.navigate({ href, replace: true, ignoreBlocker: true });
          })
          .catch(() => {
            // The old cache is already retired. New protected routes cannot load without /me.
          });
        return;
      }
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
    // Transport/5xx failures are not proof of expiry. Query retains the error for retry, and the
    // next focus/interval checks again; only confirmed 401 or identity change ends this epoch.
    void client.fetchQuery({ ...meQueryOptions, staleTime: 0 }).catch(() => {});
  };
  const timer = setInterval(check, 30_000);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  // A page restored from BFCache must revalidate before any private subtree is restored.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) sessionBoundary.revalidate();
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
