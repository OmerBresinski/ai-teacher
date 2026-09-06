import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { rememberShell } from "@/lib/last-shell";
import { libraryQueries } from "@/lib/library";
import { pageTitle } from "@/lib/page-title";
import { authLayoutRoute } from "./auth.route";

export const librarySearchSchema = z.object({
  // Search is shareable and reload-safe; layout preferences stay in client storage.
  q: z.string().optional().catch(""),
});

/**
 * Warm both lists without failing the navigation: `LibraryPage` owns the error state (Retry), so a
 * rejected prefetch must reach `useQuery`, not the route error boundary.
 */
async function prefetchLibrary(queryClient: QueryClient): Promise<void> {
  await Promise.allSettled([
    queryClient.ensureQueryData(libraryQueries.documents()),
    queryClient.ensureQueryData(libraryQueries.series()),
  ]);
}

export const libraryLayoutRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  id: "library",
  // Which shell page a document's back arrow returns to. A navigation side effect, so it lives
  // with navigation rather than in a component effect.
  beforeLoad: ({ location }) => rememberShell(location.pathname),
  component: lazyRouteComponent(() => import("./library.layout"), "LibraryLayout"),
});

export const indexRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/",
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  head: () => pageTitle("Home"),
  component: lazyRouteComponent(() => import("./index.page"), "IndexPage"),
});

export const lessonsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/lessons",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  head: () => pageTitle("Lessons"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "LessonsPage"),
});

export const worksheetsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/worksheets",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  head: () => pageTitle("Worksheets"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "WorksheetsPage"),
});

export const seriesIndexRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  head: () => pageTitle("Series"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "SeriesPage"),
});

export const seriesDetailRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series/$seriesId",
  // Hover preload (`defaultPreload: "intent"`) runs this: the one record the page needs, plus the
  // lists the sidebar counts read. The list settles first from cache and seeds `placeholderData`.
  loader: async ({ context: { queryClient }, params }) => {
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(libraryQueries.seriesDetail(params.seriesId, queryClient)),
      prefetchLibrary(queryClient),
    ]);
    if (!detail) throw notFound();
    return detail;
  },
  head: ({ loaderData }) => pageTitle(loaderData?.series.title ?? "Series"),
  component: lazyRouteComponent(() => import("./series-detail.page"), "SeriesDetailPage"),
});
