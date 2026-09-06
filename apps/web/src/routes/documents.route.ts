import type { QueryClient } from "@tanstack/react-query";
import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { libraryCache, libraryQueries } from "@/lib/library";
import { pageTitle } from "@/lib/page-title";
import { authLayoutRoute } from "./auth.route";

/**
 * The document routes (`/l/*`, `/w/*`). Each loader resolves the one document the route is about —
 * what a hover preload should fetch once a backend exists. When the list cache already knows the
 * document the page renders from that placeholder immediately and the exact record is fetched
 * behind it; otherwise the loader waits and 404s a missing id. Every page is a `lazyRouteComponent`
 * chunk: `@tj/editor` never reaches the initial bundle (ADR 0022 §8).
 */
async function loadDocument(queryClient: QueryClient, id: string) {
  const options = libraryQueries.document(id, queryClient);
  const cached = libraryCache.document(queryClient, id);
  if (cached) {
    void queryClient.prefetchQuery(options);
    return cached;
  }
  const document = await queryClient.ensureQueryData(options);
  if (!document) throw notFound();
  return document;
}

const stubPage = lazyRouteComponent(() => import("./editor-stubs.page"), "EditorStubPage");
// Built once: `validateSearch` runs on every navigation and hover preload.
export const presentSearchSchema = z.object({
  series: z.string().optional().catch(undefined),
  /** Where Present was pressed, so exit returns there: the editor (`edit`) or the viewer (`view`). */
  from: z.enum(["view", "edit"]).optional().catch(undefined),
  /** 1-based slide to open on; the viewer's Present passes the slide being viewed. */
  slide: z.coerce.number().int().positive().optional().catch(undefined),
});
const titleFrom = ({ loaderData }: { loaderData?: { title: string } }) =>
  pageTitle(loaderData?.title ?? "Document");

/** The lesson editor (TEACH-103). */
export const lessonEditorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.lessonId),
  head: titleFrom,
  component: lazyRouteComponent(() => import("./lesson-editor.page"), "LessonEditorPage"),
});

/** The read-only viewer (TEACH-100), moved here when the editor took `/l/$lessonId`. */
export const lessonViewRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId/view",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.lessonId),
  head: titleFrom,
  component: lazyRouteComponent(() => import("./lesson-viewer.page"), "LessonViewerPage"),
});

export const lessonPresentRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId/present",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.lessonId),
  validateSearch: (search) => presentSearchSchema.parse(search),
  head: ({ loaderData }) => pageTitle(`${loaderData?.title ?? "Lesson"} · Presenting`),
  // Present mode (TEACH-101).
  component: lazyRouteComponent(() => import("./lesson-present.page"), "LessonPresentPage"),
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
