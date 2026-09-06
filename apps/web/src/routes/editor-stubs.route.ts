import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { libraryQueries } from "@/lib/library";
import { authLayoutRoute } from "./auth.route";

function editorLoader({ context }: { context: { queryClient: QueryClient } }) {
  return context.queryClient.ensureQueryData(libraryQueries.documents());
}

export const lessonEditorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId",
  loader: editorLoader,
  component: lazyRouteComponent(() => import("./editor-stubs.page"), "EditorStubPage"),
});

export const lessonPresentRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId/present",
  loader: editorLoader,
  component: lazyRouteComponent(() => import("./editor-stubs.page"), "EditorStubPage"),
});

export const worksheetEditorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/w/$worksheetId",
  loader: editorLoader,
  component: lazyRouteComponent(() => import("./editor-stubs.page"), "EditorStubPage"),
});

export const worksheetPrintRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/w/$worksheetId/print",
  loader: editorLoader,
  component: lazyRouteComponent(() => import("./editor-stubs.page"), "EditorStubPage"),
});
