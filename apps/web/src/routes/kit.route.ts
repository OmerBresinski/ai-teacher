import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { authLayoutRoute } from "./auth.route";

/**
 * The visual acceptance surface for the shared UI package. Available in every build, behind
 * sign-in (a child of `authLayoutRoute`), so the owner can judge the kit on the deployed app.
 * Lazy: the gallery chunk loads only when the route is visited.
 */
export const kitRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/kit",
  component: lazyRouteComponent(() => import("./kit.page"), "KitPage"),
});
