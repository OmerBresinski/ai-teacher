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

// Built once: `validateSearch` runs on every navigation and hover preload.
export const presentSearchSchema = z.object({
  series: z.string().optional().catch(undefined),
  /** Where Present was pressed, so exit returns there: the editor (`edit`) or the viewer (`view`). */
  from: z.enum(["view", "edit"]).optional().catch(undefined),
  /** 1-based slide to open on; the viewer's Present passes the slide being viewed. */
  slide: z.coerce.number().int().positive().optional().catch(undefined),
});
/**
 * `/w/$worksheetId/print?auto=1` prints as soon as the sheet is measured (TeachDeck
 * `worksheetPrintHref`). The router's parser JSON-decodes `1` to a number, so both spellings are
 * accepted and normalised to the string; anything else is dropped rather than thrown.
 */
export const worksheetPrintSearchSchema = z.object({
  auto: z
    .union([z.literal("1"), z.literal(1)])
    .transform((): "1" => "1")
    .optional()
    .catch(undefined),
});
/**
 * `/l/$lessonId/print` (ADR 0023 §2; TeachDeck `lib/export/pdf.ts` writes exactly these):
 * `auto=1`, `answers=1`, `notes=1`, `handout=3`, `slides=<range>`. The parser JSON-decodes bare
 * digits, so `1` / `3` arrive as numbers and a range like `slides=4` as `4`; each is normalised to
 * its string and anything else is dropped rather than thrown.
 */
const flag = <T extends string>(value: T) =>
  z
    .union([z.literal(value), z.literal(Number(value))])
    .transform((): T => value)
    .optional()
    .catch(undefined);
export const lessonPrintSearchSchema = z.object({
  auto: flag("1"),
  answers: flag("1"),
  notes: flag("1"),
  handout: flag("3"),
  slides: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional()
    .catch(undefined),
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

/** The lesson print layout (TEACH-110; ADR 0023 §2): one page per slide, no app chrome. */
export const lessonPrintRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/l/$lessonId/print",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.lessonId),
  validateSearch: (search) => lessonPrintSearchSchema.parse(search),
  head: titleFrom,
  component: lazyRouteComponent(() => import("./lesson-print.page"), "LessonPrintPage"),
});

/** The worksheet editor (TEACH-109). */
export const worksheetEditorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/w/$worksheetId",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.worksheetId),
  head: titleFrom,
  component: lazyRouteComponent(() => import("./worksheet-editor.page"), "WorksheetEditorPage"),
});

/** The print layout (TEACH-108; ADR 0023 §2): the paginated sheet, no app chrome. */
export const worksheetPrintRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/w/$worksheetId/print",
  loader: ({ context, params }) => loadDocument(context.queryClient, params.worksheetId),
  validateSearch: (search) => worksheetPrintSearchSchema.parse(search),
  head: titleFrom,
  component: lazyRouteComponent(() => import("./worksheet-print.page"), "WorksheetPrintPage"),
});
