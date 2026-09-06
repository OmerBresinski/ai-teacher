import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { libraryCache, libraryQueries } from "@/lib/library";
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
  // Hover preload (`defaultPreload: "intent"`) runs this. The lists settle from cache, so the page
  // renders at once from `placeholderData`; the exact record is fetched without blocking and the
  // page's `useQuery` picks it up. Unknown ids are 404'd from the cached list without a round trip.
  loader: async ({ context: { queryClient }, params }) => {
    await prefetchLibrary(queryClient);
    const options = libraryQueries.seriesDetail(params.seriesId, queryClient);
    const cached = libraryCache.seriesDetail(queryClient, params.seriesId);
    if (!cached) {
      const detail = await queryClient.ensureQueryData(options);
      if (!detail) throw notFound();
      return detail;
    }
    void queryClient.prefetchQuery(options);
    return cached;
  },
  head: ({ loaderData }) => pageTitle(loaderData?.series.title ?? "Series"),
  component: lazyRouteComponent(() => import("./series-detail.page"), "SeriesDetailPage"),
});
