import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { libraryQueries } from "@/lib/library";
import { pageTitle } from "@/lib/page-title";
import { libraryLayoutRoute } from "./library.route";

/**
 * `/worksheets/new?lesson=<id>` — the worksheet creation flow (TEACH-184): Source, then Kind.
 * Inside the library shell so the sidebar stays. With `lesson` set (the lesson editor's
 * Worksheet action) the flow opens on Kind for that lesson. The loader warms the recent lessons
 * list the Source step reads and never fails the navigation: the page owns its empty state.
 */
export const worksheetCreateSearchSchema = z.object({
  lesson: z.string().optional().catch(undefined),
});

export const worksheetCreateRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/worksheets/new",
  validateSearch: (search) => worksheetCreateSearchSchema.parse(search),
  loader: ({ context }) =>
    Promise.allSettled([
      context.queryClient.ensureInfiniteQueryData(
        libraryQueries.documents("lesson", { sort: "edited" }),
      ),
    ]),
  head: () => pageTitle("New worksheet"),
  component: lazyRouteComponent(() => import("./worksheet-create.page"), "WorksheetCreatePage"),
});
