import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { DEV_JOBS_ENABLED } from "./dev-jobs.route";
import { rootRoute } from "./root.route";

/**
 * Live writing replay (spike/live-writing): a recorded run's job events played back into the
 * generating shell at their real times, so the typing can be tuned without model calls. Dev only,
 * like `/dev/jobs`. `?fixture=<name>` reads `public/live-replay/<name>.json`; `?speed=` scales time.
 */
export const devLiveReplayRoute = DEV_JOBS_ENABLED
  ? createRoute({
      getParentRoute: () => rootRoute,
      path: "/dev/live-replay",
      component: lazyRouteComponent(() => import("./dev-live-replay.page"), "DevLiveReplayPage"),
    })
  : null;
