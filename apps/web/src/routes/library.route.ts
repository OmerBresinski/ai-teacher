import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { libraryQueries } from "@/lib/library";
import { authLayoutRoute } from "./auth.route";

export const librarySearchSchema = z.object({
  // Search is shareable and reload-safe; layout preferences stay in client storage.
  q: z.string().optional().catch(""),
});

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
  component: lazyRouteComponent(() => import("./index.page"), "IndexPage"),
});

export const lessonsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/lessons",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  component: lazyRouteComponent(() => import("./library-kind.page"), "LessonsPage"),
});

export const worksheetsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/worksheets",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  component: lazyRouteComponent(() => import("./library-kind.page"), "WorksheetsPage"),
});

export const seriesIndexRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series",
  validateSearch: librarySearchSchema,
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  component: lazyRouteComponent(() => import("./library-kind.page"), "SeriesPage"),
});

export const seriesDetailRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/series/$seriesId",
  loader: ({ context }) => prefetchLibrary(context.queryClient),
  component: lazyRouteComponent(() => import("./series-detail.page"), "SeriesDetailPage"),
});
