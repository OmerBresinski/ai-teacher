import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import type { LibraryMode } from "@/components/library/library-model";
import { libraryCache, libraryQueries, SORTS, type Sort } from "@/lib/library";
import { pageTitle } from "@/lib/page-title";
import { readPreference } from "@/lib/use-preference";
import { authLayoutRoute } from "./auth.route";

export const librarySearchSchema = z.object({
  // Search is shareable and reload-safe; layout preferences stay in client storage.
  q: z.string().optional().catch(""),
});

/**
 * Warm the first page of the lists a page reads, without failing the navigation: `LibraryPage`
 * owns the error state (Retry), so a rejected prefetch must reach `useInfiniteQuery`, not the
 * route error boundary. Home reads all three; a kind page reads its own (the sidebar's counts
 * fetch the default-keyed lists themselves, in parallel, and never block the navigation). The sort
 * preference is read here so the key warmed is the one the page mounts with. The search term is
 * deliberately **not** a loader dependency: the box writes `q` to the URL on every keystroke, and
 * a loader keyed on it would fetch per keystroke and defeat the page's 250 ms debounce.
 */
function prefetchLibrary(queryClient: QueryClient, mode: LibraryMode): Promise<unknown> {
  const sort = readSortPreference();
  const documents = (kind: "lesson" | "worksheet") =>
    queryClient.ensureInfiniteQueryData(libraryQueries.documents(kind, { sort }));
  const series = () => queryClient.ensureInfiniteQueryData(libraryQueries.series({ sort }));
  return Promise.allSettled(
    mode === "home"
      ? [documents("lesson"), documents("worksheet"), series()]
      : mode === "series"
        ? [series()]
        : [documents(mode)],
  );
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
  loader: ({ context }) => prefetchLibrary(context.queryClient, "home"),
  head: () => pageTitle("Home"),
  component: lazyRouteComponent(() => import("./index.page"), "IndexPage"),
});

export const lessonsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/lessons",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient, "lesson"),
  head: () => pageTitle("Lessons"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "LessonsPage"),
});

export const worksheetsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/worksheets",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient, "worksheet"),
  head: () => pageTitle("Worksheets"),
  component: lazyRouteComponent(() => import("./library-kind.page"), "WorksheetsPage"),
});

export const seriesIndexRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient, "series"),
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
    await prefetchLibrary(queryClient, "series");
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
