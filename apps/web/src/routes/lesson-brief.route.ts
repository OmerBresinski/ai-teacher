import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { BRIEF_TOPIC_MAX } from "@tj/domain/documents";
import { z } from "zod";
import { pageTitle } from "@/lib/page-title";
import { flag } from "./documents.route";
import { libraryLayoutRoute } from "./library.route";

/**
 * `/lessons/new?topic=<text>&source=1` — the marketing homepage's hero box and upload icon send a
 * visitor here with a topic to prefill and/or the "Start from your material" drop zone to focus
 * (TEACH-307, TEACH-309, UX ruling 68). The router JSON-decodes search values, so `?topic=123`
 * arrives as the number 123 and `?topic=%5B...%5D` as an array; both are dropped rather than
 * thrown, the same lenient pattern as `signInSearchSchema` and `librarySearchSchema.q`
 * (search-schemas.test.ts). `source` reuses `flag("1")` (documents.route.ts): the parser also
 * decodes `?source=1` to the number 1.
 */
export const lessonBriefSearchSchema = z.object({
  topic: z
    .string()
    .transform((v) => v.slice(0, BRIEF_TOPIC_MAX))
    .optional()
    .catch(undefined),
  source: flag("1"),
});

/**
 * `/lessons/new` — the lesson brief (F01 item 2, TEACH-122). Inside the library shell so the
 * sidebar stays; no loader — the page needs nothing from the server before the teacher types.
 */
export const lessonBriefRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/lessons/new",
  validateSearch: lessonBriefSearchSchema,
  head: () => pageTitle("New lesson"),
  component: lazyRouteComponent(() => import("./lesson-brief.page"), "LessonBriefPage"),
});
