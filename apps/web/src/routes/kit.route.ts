import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { NotFoundPage } from "@/components/not-found-page";
import { authLayoutRoute } from "./auth.route";

/** Development-only visual acceptance surface for the shared UI package. */
export const kitRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/kit",
  // Keep the dynamic import inside Vite's compile-time DEV branch. Importing a route module that
  // merely contained this lazy callback was enough for Vite to retain the gallery chunk in builds.
  component: import.meta.env.DEV
    ? lazyRouteComponent(() => import("./kit.page"), "KitPage")
    : NotFoundPage,
});
