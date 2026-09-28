import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { BRIEF_TOPIC_MAX } from "@tj/domain/documents";
import { z } from "zod";
import { pageTitle } from "@/lib/page-title";
import { authLayoutRoute } from "./auth.route";
import { flag } from "./documents.route";

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
  lesson: z.uuid().optional().catch(undefined),
});

/**
 * `/lessons/new` — the focused intake, outside the sidebar but behind the same auth guard.
 * `?lesson=` resumes a durable proposed plan; a new brief needs no loader.
 */
export const lessonBriefRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/lessons/new",
  validateSearch: lessonBriefSearchSchema,
  head: () => pageTitle("New lesson"),
  component: lazyRouteComponent(() => import("./lesson-brief.page"), "LessonBriefPage"),
});
