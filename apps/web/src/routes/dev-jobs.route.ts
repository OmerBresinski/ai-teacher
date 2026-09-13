import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { authLayoutRoute } from "./auth.route";

export const devJobsSearchSchema = z.object({
  /**
   * Job to follow; kept in the URL so a reload reconnects and the server replays events.
   * `.catch(undefined)` drops malformed (e.g. JSON-decoded numeric) values — see search-schemas.test.ts.
   */
  jobId: z.string().optional().catch(undefined),
});

/**
 * The Jobs / SSE demo ships only in `vite dev` and the e2e preview build (TEACH-81, audit F05).
 * `import.meta.env.*` is read directly, not through the parsed `env`, so Vite inlines the
 * literals and the `createRoute(...)` branch — with the `dev-jobs.page` chunk its lazy import
 * would emit — is dead code in a production bundle. Not `VITE_APP_ENV !== "production"`: that
 * defaults to `"development"` and would fail open on a build that forgot the variable.
 */
export const DEV_JOBS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_APP_ENV === "preview";

/** Development aid for the ADR 0012 SSE demo — not a product route; `null` in production. */
export const devJobsRoute = DEV_JOBS_ENABLED
  ? createRoute({
      getParentRoute: () => authLayoutRoute,
      path: "/dev/jobs",
      validateSearch: devJobsSearchSchema,
      component: lazyRouteComponent(() => import("./dev-jobs.page"), "DevJobsPage"),
    })
  : null;
