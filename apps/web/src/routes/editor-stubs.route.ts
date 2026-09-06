import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { libraryQueries } from "@/lib/library";
import { pageTitle } from "@/lib/page-title";
import { authLayoutRoute } from "./auth.route";

/**
 * Editor stubs (`@tj/editor` replaces the page, not the routes). Each loader resolves the one
 * document the route is about — what a hover preload should fetch once a backend exists — and
 * turns a missing id into a 404 before the page renders.
 */
async function loadDocument(queryClient: QueryClient, id: string) {
  const document = await queryClient.ensureQueryData(libraryQueries.document(id, queryClient));
  if (!document) throw notFound();
  return document;
}

const stubPage = lazyRouteComponent(() => import("./editor-stubs.page"), "EditorStubPage");
const titleFrom = ({ loaderData }: { loaderData?: { title: string } }) =>
  pageTitle(loaderData?.title ?? "Document");

export const lessonEditorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.lessonId),
  head: titleFrom,
  component: stubPage,
});

export const lessonPresentRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId/present",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.lessonId),
  validateSearch: (search) =>
    z.object({ series: z.string().optional().catch(undefined) }).parse(search),
  head: titleFrom,
  component: stubPage,
});

export const worksheetEditorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/w/$worksheetId",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.worksheetId),
  head: titleFrom,
  component: stubPage,
});

export const worksheetPrintRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/w/$worksheetId/print",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.worksheetId),
  head: titleFrom,
  component: stubPage,
});
