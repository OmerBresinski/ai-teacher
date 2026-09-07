import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageTitle } from "@/lib/page-title";
import { libraryLayoutRoute } from "./library.route";

/**
 * `/lessons/new` — the lesson brief (F01 item 2, TEACH-122). Inside the library shell so the
 * sidebar stays; no loader — the page needs nothing from the server before the teacher types.
 */
export const lessonBriefRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/lessons/new",
  head: () => pageTitle("New lesson"),
  component: lazyRouteComponent(() => import("./lesson-brief.page"), "LessonBriefPage"),
});
