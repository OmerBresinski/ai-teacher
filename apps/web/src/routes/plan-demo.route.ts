import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { NotFoundPage } from "@/components/not-found-page";
import { pageTitle } from "@/lib/page-title";
import { libraryLayoutRoute } from "./library.route";

/**
 * `/lessons/plan-demo` — development-only entry to the plan review prototype: seeds
 * `plannedLesson()` into the query cache and opens `/l/<its id>`. Not a product route; it is
 * registered only under `import.meta.env.DEV` (like `/kit`).
 */
export const planDemoRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/lessons/plan-demo",
  head: () => pageTitle("Plan review demo"),
  component: import.meta.env.DEV
    ? lazyRouteComponent(() => import("./plan-demo.page"), "PlanDemoPage")
    : NotFoundPage,
});
