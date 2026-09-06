/**
 * Code-based route tree (ADR 0004). Route definitions live in `src/routes/<name>.route.ts`,
 * their components in `<name>.page.tsx` (loaded with `lazyRouteComponent`), and the tree is
 * assembled only here. No file-based routing, no generated route tree.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { ThemeProvider, Toaster, TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { rememberShell } from "@/lib/last-shell";
import { queryClient } from "@/lib/query";
import { authLayoutRoute } from "@/routes/auth.route";
import { devJobsRoute } from "@/routes/dev-jobs.route";
import {
  lessonEditorRoute,
  lessonPresentRoute,
  worksheetEditorRoute,
  worksheetPrintRoute,
} from "@/routes/editor-stubs.route";
import { kitRoute } from "@/routes/kit.route";
import {
  indexRoute,
  lessonsRoute,
  libraryLayoutRoute,
  seriesDetailRoute,
  seriesIndexRoute,
  worksheetsRoute,
} from "@/routes/library.route";
import { rootRoute } from "@/routes/root.route";
import { signInRoute } from "@/routes/sign-in.route";

export const routeTree = rootRoute.addChildren([
  signInRoute,
  authLayoutRoute.addChildren([
    libraryLayoutRoute.addChildren([
      indexRoute,
      lessonsRoute,
      worksheetsRoute,
      seriesIndexRoute,
      seriesDetailRoute,
    ]),
    lessonEditorRoute,
    lessonPresentRoute,
    worksheetEditorRoute,
    worksheetPrintRoute,
    devJobsRoute,
    ...(import.meta.env.DEV ? [kitRoute] : []),
  ]),
]);

/**
 * App-wide providers. They live in `Wrap` rather than the root route's `component` so that the
 * root `errorComponent`, `notFoundComponent` and `defaultPendingComponent` — which replace the
 * root component when they render — still see the query client and the theme.
 */
function Wrap({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingComponent: RoutePendingPage,
  // Cold load awaits `/me` in `beforeLoad` and ADR 0004 targets a <1 s shell, so the skeleton
  // appears after 100 ms (default is 1000 ms of nothing). Not 0: the first visit to every route in
  // a session awaits its `lazyRouteComponent` chunk, and at 0 ms even a cached module — an
  // `import()` resolving in a microtask — replaced the page with the skeleton for `pendingMinMs`.
  // Under 100 ms reads as instant; above it the skeleton is held for the minimum so it never flashes.
  defaultPendingMs: 100,
  defaultPendingMinMs: 200,
  scrollRestoration: true,
  // Search params and loader data keep their identity when their contents are unchanged, so
  // `useSearch()` / `useLoaderData()` consumers do not re-render on every navigation.
  defaultStructuralSharing: true,
  Wrap,
});

// Which shell page a document's back arrow returns to (`useShellReturn`). Committed navigations
// only: `beforeLoad`/`loader` also run for hover preloads, which must not move the return target.
router.subscribe("onResolved", ({ toLocation }) => rememberShell(toLocation.pathname));

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
