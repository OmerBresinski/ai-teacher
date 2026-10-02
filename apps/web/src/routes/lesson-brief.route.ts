import { createRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { BRIEF_TOPIC_MAX } from "@tj/domain/documents";
import { z } from "zod";
import { pageTitle } from "@/lib/page-title";
import { flag } from "./documents.route";
import { guestLayoutRoute } from "./guest.route";

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
 * The brief URL a visitor comes back to after `/sign-in`, topic (and upload) intact. Built here
 * rather than from `location.href`, whose re-serialised search JSON-quotes `source` (`"1"`).
 */
export function briefRedirect(topic: string | undefined, source = false): string {
  const params = new URLSearchParams();
  if (topic?.trim()) params.set("topic", topic.trim());
  if (source) params.set("source", "1");
  const query = params.toString();
  return query ? `/lessons/new?${query}` : "/lessons/new";
}

/**
 * `/lessons/new` — the focused intake, outside the sidebar. Under the guest layout (TEACH-244):
 * a signed-out visitor may write a brief; the account is made anonymously on submit. Uploads stay
 * account-only (UX ruling 110), so `?source=1` without an account signs in first, as before.
 * `?lesson=` resumes a durable proposed plan; a new brief needs no loader.
 */
export const lessonBriefRoute = createRoute({
  getParentRoute: () => guestLayoutRoute,
  path: "/lessons/new",
  validateSearch: lessonBriefSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (search.source === "1" && (!context.me || context.me.user.isAnonymous)) {
      throw redirect({ to: "/sign-in", search: { redirect: briefRedirect(search.topic, true) } });
    }
  },
  head: () => pageTitle("New lesson"),
  component: lazyRouteComponent(() => import("./lesson-brief.page"), "LessonBriefPage"),
});
