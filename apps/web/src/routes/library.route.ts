import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { libraryCache, libraryQueries, SORTS, type Sort } from "@/lib/library";
import { pageTitle } from "@/lib/page-title";
import { readPreference } from "@/lib/use-preference";
import { authLayoutRoute } from "./auth.route";

export const librarySearchSchema = z.object({
  // Search is shareable and reload-safe; layout preferences stay in client storage.
  q: z.string().optional().catch(""),
});

/**
 * Warm the first page of each list without failing the navigation: `LibraryPage` owns the error
 * state (Retry), so a rejected prefetch must reach `useInfiniteQuery`, not the route error
 * boundary. The sort preference is read here so the page's first query is the one warmed.
 */
async function prefetchLibrary(queryClient: QueryClient, q = ""): Promise<void> {
  const sort = readSortPreference();
  await Promise.allSettled([
    queryClient.ensureInfiniteQueryData(libraryQueries.documents("lesson", { sort, q })),
    queryClient.ensureInfiniteQueryData(libraryQueries.documents("worksheet", { sort, q })),
    queryClient.ensureInfiniteQueryData(libraryQueries.series({ sort, q })),
  ]);
}

/** The `tj:library:sort` preference (apps/web/AGENTS.md), as `usePreference` reads it. */
function readSortPreference(): Sort {
  const stored = readPreference("tj:library:sort");
  return SORTS.includes(stored as Sort) ? (stored as Sort) : "edited";
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
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: ({ context, deps }) => prefetchLibrary(context.queryClient, deps.q),
  head: () => pageTitle("Lessons"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "LessonsPage"),
});

export const worksheetsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/worksheets",
  validateSearch: librarySearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: ({ context, deps }) => prefetchLibrary(context.queryClient, deps.q),
  head: () => pageTitle("Worksheets"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "WorksheetsPage"),
});

export const seriesIndexRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series",
  validateSearch: librarySearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: ({ context, deps }) => prefetchLibrary(context.queryClient, deps.q),
  head: () => pageTitle("Series"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "SeriesPage"),
});

export const seriesDetailRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series/$seriesId",
  // Hover preload (`defaultPreload: "intent"`) runs this. The lists settle from cache, so the page
  // renders at once from `placeholderData`; the exact record is fetched without blocking and the
  // page's `useQuery` picks it up. A missing series is not a 404: the page renders TeachDeck's
  // "deleted or never existed" state with a way back (TEACH-92), so the loader resolves `null`.
  loader: async ({ context: { queryClient }, params }) => {
    await prefetchLibrary(queryClient);
    const options = libraryQueries.seriesDetail(params.seriesId, queryClient);
    const cached = libraryCache.seriesDetail(queryClient, params.seriesId);
    if (cached) {
      void queryClient.prefetchQuery(options);
      return cached;
    }
    return queryClient.ensureQueryData(options);
  },
  head: ({ loaderData }) => pageTitle(loaderData?.series.title ?? "Series"),
  component: lazyRouteComponent(() => import("./series-detail.page"), "SeriesDetailPage"),
});
