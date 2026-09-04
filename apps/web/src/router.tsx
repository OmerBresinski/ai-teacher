/**
 * Code-based route tree (ADR 0004). Route definitions live in `src/routes/<name>.route.ts`,
 * their components in `<name>.page.tsx` (loaded with `lazyRouteComponent`), and the tree is
 * assembled only here. No file-based routing, no generated route tree.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { ThemeProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { queryClient } from "@/lib/query";
import { authLayoutRoute } from "@/routes/auth.route";
import { devJobsRoute } from "@/routes/dev-jobs.route";
import { indexRoute } from "@/routes/index.route";
import { rootRoute } from "@/routes/root.route";
import { signInRoute } from "@/routes/sign-in.route";

export const routeTree = rootRoute.addChildren([
  signInRoute,
  authLayoutRoute.addChildren([indexRoute, devJobsRoute]),
]);

/**
 * App-wide providers. They live in `Wrap` rather than the root route's `component` so that the
 * root `errorComponent`, `notFoundComponent` and `defaultPendingComponent` — which replace the
 * root component when they render — still see the query client and the theme.
 */
function Wrap({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingComponent: RoutePendingPage,
  // Cold load awaits `/me` in `beforeLoad` and ADR 0004 targets a <1 s shell, so show the skeleton
  // immediately (default is 1000 ms of nothing); the short minimum avoids a flash on fast loads.
  defaultPendingMs: 0,
  defaultPendingMinMs: 200,
  scrollRestoration: true,
  Wrap,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
