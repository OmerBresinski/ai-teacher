import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { authLayoutRoute } from "./auth.route";

export const devJobsSearchSchema = z.object({
  /** Job to follow; kept in the URL so a reload reconnects and the server replays events. */
  jobId: z.string().optional(),
});

/** Development aid for the ADR 0012 SSE demo — not a product route. */
export const devJobsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/dev/jobs",
  validateSearch: devJobsSearchSchema,
  component: lazyRouteComponent(() => import("./dev-jobs.page"), "DevJobsPage"),
});
